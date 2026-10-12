-- DRAFT production scoring/recovery/working time. No activation or source rewrite.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
  or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production scoring target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_governed_work_actions_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='f919f590057ccaa257c0b69b4cffb8084c9b01c4d6ba638600eac5e412373d3f') then raise exception 'Pinned production actions prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_scoring_working_time_v1')
  or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['learn_performance_corrections','learn_assessments','learn_assessment_cancellations','learn_team_work_measurement_runs','learn_work_collection_runs','learn_work_collection_items','learn_work_calendar_versions','learn_work_calendar_publications','learn_work_calendar_cancellations','learn_work_delay_events','learn_work_delay_cancellations','learn_working_collection_runs','learn_working_collection_items','learn_correction_cancellations']))
  or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['learn_performance_correct','learn_assessment_immutable','learn_assessment_save','learn_assessment_resolve','learn_team_work_residence_collect','learn_work_collection_immutable','learn_work_collection_access','learn_work_collection_history','learn_work_frozen_owner','learn_work_collection_calculate','learn_work_collection_result','learn_work_collection_cell_lock','learn_work_collection_begin','learn_work_collection_step','learn_work_collection_abandon','learn_work_collection_status','learn_work_collection_evidence','learn_work_calendar_immutable','learn_work_calendar_validate','learn_work_calendar_expand','learn_work_calendar_version_result','learn_work_calendar_request','learn_work_calendar_resolve','learn_work_calendar_save','learn_work_calendar_publish','learn_work_calendar_read','learn_work_calendar_preview','learn_work_calendar_snapshot','learn_work_delay_immutable','learn_work_delay_request','learn_work_delay_entry','learn_work_delay_record','learn_work_delay_resolve','learn_work_delay_read','learn_work_delay_evidence','learn_work_delay_snapshot','learn_working_time_ranges','learn_working_time_windows','learn_working_time_micros','learn_working_time_calculate','learn_working_collection_immutable','learn_working_rule_states','learn_working_calendar_freeze','learn_working_delay_freeze','learn_work_measurement_receipt_check','learn_measurement_receipt_constraint','learn_review_receipt_constraint','learn_assessment_receipt_constraint','learn_performance_correction_resolve'])) then
   raise exception 'Production scoring candidate already exists; inspect before retry';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array['tenants','profiles','team_members','org_units','view_as_context','config_versions','operating_profile_entries','learn_scorecard_publications','learn_member_history','measurements','learn_performance_reviews','learn_work_measurement_runs','intelligence_objects','object_state_history','interactions','email_messages','phone_calls','phone_recordings','jobs','customer_cards']);
 if observed is distinct from '[{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"config_versions","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"artifact_kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"artifact_key","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"version","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"c248d674101d8b24c97279095c3a6dde"},{"name":"supersedes","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"author","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"c08e9b72a1f5c2105a2649c074575a84"},{"name":"note","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"payload_hash","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"published_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"d0714a0b99032ac73cb8b84b79a554a5","name":"config_versions_lookup","valid":true},{"hash":"27f7f0de2e695476007b2ee68082c18d","name":"config_versions_pkey","valid":true},{"hash":"13d4094029a2401f65e6ebd9170caabe","name":"config_versions_published_uk","valid":true}],"forceRls":false,"policies":[{"name":"config_versions_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"4da561cf20b60ddd6d041662476ff459","permissive":"PERMISSIVE"}],"triggers":[{"hash":"7c417b821d27e83ff55dbf731af8a1f3","name":"learn_scorecard_revision_immutable","enabled":"O"},{"hash":"97a38f86fce45353cb4c509dd1a3f03f","name":"learn_scorecard_revisions_no_truncate","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"config_versions_pkey","validated":true},{"hash":"64e4f9a670965dbb125f290807ec6f80","kind":"c","name":"config_versions_status_check","validated":true},{"hash":"6ff3b5fcfe868a23f4d1427f16abd05d","kind":"f","name":"config_versions_supersedes_fkey","validated":true},{"hash":"6640173aadc2390c2c2c19d76af2a4f2","kind":"f","name":"config_versions_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"customer_cards","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"title","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"summary","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d2e629d884dd34355a15552e5b518a5"},{"name":"priority","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"85d245f36de3b9cecc91228801a5247d"},{"name":"owner_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"due_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"latest_activity_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"recommended_action","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"context","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"assigned_team_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"watchers","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"followers","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"helper_suggestions","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"priority_score","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority_inputs","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"locked_fields","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"a353edc9afd9f0fc7e68f00793ab2cc4","name":"customer_cards_pkey","valid":true},{"hash":"3e66bfccc40049ca8a2bda1f99447e58","name":"customer_cards_tenant_activity_idx","valid":true},{"hash":"e6846f1fa5da9015a49bebc34efc5a0b","name":"customer_cards_tenant_company_idx","valid":true},{"hash":"5266765be7d2d1dbb11d350513b8d662","name":"customer_cards_tenant_person_idx","valid":true},{"hash":"0e7faa01b3e9d4f1ca7ff2b0b22a7762","name":"customer_cards_tenant_priority_idx","valid":true},{"hash":"c627136b94cf9123bfd3e965d14129e9","name":"customer_cards_tenant_score_idx","valid":true},{"hash":"8aec36a2a422bac4e872b104db4e8dc6","name":"customer_cards_tenant_status_idx","valid":true}],"forceRls":false,"policies":[{"name":"customer_cards_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"e9fe5f91503ebba1c507f9e0c30f4f4d","name":"customer_cards_set_updated_at","enabled":"O"},{"hash":"efe1e538d97c8e8cdd6f3def4ce9fb7f","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"c393f886f52b6010a512c5c0980ab536","kind":"f","name":"customer_cards_company_id_fkey","validated":true},{"hash":"bcfe24d956220872d4db2fac32db2f22","kind":"f","name":"customer_cards_person_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"customer_cards_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"email_messages","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"18d098a428c784185fe7bc34d1784903"},{"name":"provider_message_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"provider_thread_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"to_emails","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"cc_emails","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"subject","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"snippet","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"body_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"body_html","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"sent_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"received_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"direction","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"raw_payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"origin","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_delivery_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_automation_intent_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_campaign_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"ddab13827db6fc862b347926210f2b5f","name":"email_messages_from_idx","valid":true},{"hash":"aa0806d4070a7b3212a80a84eb9c7d5c","name":"email_messages_pkey","valid":true},{"hash":"b6c142a1e1681434cb7a2e0292da277d","name":"email_messages_received_idx","valid":true},{"hash":"fe1c7bcc6524405f48f28a236599ee8e","name":"email_messages_tenant_id_idx","valid":true},{"hash":"ca8629c22d3dd310b1126f117b9b008b","name":"email_messages_tenant_id_provider_provider_message_id_key","valid":true},{"hash":"a2e59fd4b71cb47545b35622ff50fd81","name":"email_messages_thread_idx","valid":true}],"forceRls":false,"policies":[{"name":"email_messages_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"},{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"}],"triggers":[{"hash":"87e7af360d7a3fb98bcdea12d9105317","name":"email_messages_set_updated_at","enabled":"O"}],"constraints":[{"hash":"b62110fa0a5753efbae5ef5b8caccc97","kind":"f","name":"email_messages_origin_campaign_fk","validated":true},{"hash":"1220af29a1985a4dabe03353bd48d8fe","kind":"c","name":"email_messages_origin_check","validated":true},{"hash":"a30c441924cbce62b8ad5027db53e1c5","kind":"f","name":"email_messages_origin_delivery_fk","validated":true},{"hash":"19a3d8f70792afd54bb9f0f14df3e6a6","kind":"f","name":"email_messages_origin_intent_fk","validated":true},{"hash":"e865d926f40b1e90e54c88f2d92a7bc1","kind":"f","name":"email_messages_origin_person_fk","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"email_messages_pkey","validated":true},{"hash":"7b594e8645b3085fdc803326bd97c4e4","kind":"u","name":"email_messages_tenant_id_provider_provider_message_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"intelligence_objects","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"domain","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"object_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"responsible_ref","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"accountable_ref","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"waiting_on_ref","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"severity","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"ambiguity","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"risk","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"reversibility","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"01ef3e7e55bf7555349ed3a07036fcb6"},{"name":"domain_state","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"deadline","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"blocking","type":"uuid[]","notNull":true,"identity":"","generated":"","defaultHash":"30c8ce2479a7d03ad0036cb8f8bf8a8d"},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"source_interactions","type":"uuid[]","notNull":true,"identity":"","generated":"","defaultHash":"30c8ce2479a7d03ad0036cb8f8bf8a8d"},{"name":"source_entities","type":"uuid[]","notNull":true,"identity":"","generated":"","defaultHash":"30c8ce2479a7d03ad0036cb8f8bf8a8d"},{"name":"created_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_from","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"policy_applied","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"decision_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"attributes","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"version","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"c4ca4238a0b923820dcc509a6f75849b"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"object_class","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"learning_applied","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"3befa4b26c5c69251cd117dab3179f90","name":"intelligence_objects_pkey","valid":true},{"hash":"6e8ab043def32a70b5801a13b5d9012b","name":"io_class","valid":true},{"hash":"7f510d307522cb4ba9dcc3067e0e6ae6","name":"io_deadline","valid":true},{"hash":"f9c6d8dc6e7d4b8eb817dd2ee9554f48","name":"io_entities","valid":true},{"hash":"f37314084809a4c722370a02628a6ab8","name":"io_lookup","valid":true},{"hash":"01926df76cee0788c0707cc60f190e1a","name":"io_srcint","valid":true}],"forceRls":false,"policies":[{"name":"io_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"0422320a2ff1673051b765915492b803","name":"io_set_updated_at","enabled":"O"},{"hash":"a9eb61d2185ce33a3bcfd4bc13f4f580","name":"learn_capture_work_change","enabled":"O"},{"hash":"0da8636a666b72d1b553580f160c4e8b","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"0eca77799b17696a29a8341e552b3aa2","kind":"c","name":"intelligence_objects_ambiguity_check","validated":true},{"hash":"fe05d9f5fdc7c955f732c72e312b120c","kind":"c","name":"intelligence_objects_confidence_check","validated":true},{"hash":"ed84e3da79e13c3d1c93e3269f8cacfc","kind":"f","name":"intelligence_objects_object_class_fk","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"intelligence_objects_pkey","validated":true},{"hash":"0fdcd936867b15707fee1110621a0167","kind":"c","name":"intelligence_objects_reversibility_check","validated":true},{"hash":"05f42cecf82696b448e25f6a522a52d2","kind":"c","name":"intelligence_objects_risk_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"intelligence_objects_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"interactions","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_connector_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_table","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_external_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"interaction_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"direction","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"occurred_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"summary","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"body_preview","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_address","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"to_addresses","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"cc_addresses","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"phone_from","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"phone_to","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"processing_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d0c12821e68f0fc31291c72ad568aa9"},{"name":"sentiment","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_thread_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_job_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_task_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"source_updated_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source_version","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_campaign_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"386b7aa4a596d1f7a436f82ee5cd30d1","name":"interactions_pkey","valid":true},{"hash":"e9634fa8eca4b28f9d63657404df3fae","name":"interactions_related_campaign_idx","valid":true},{"hash":"8eaaf68213fe01dc3342f1135af48b37","name":"interactions_tenant_company_idx","valid":true},{"hash":"344e9c6e9a40d3f4cc5ffdd75d892e06","name":"interactions_tenant_connector_occurred_idx","valid":true},{"hash":"78eb70cc7e2fa21d550574b7d7fd2567","name":"interactions_tenant_id_source_table_source_id_key","valid":true},{"hash":"b872f2d916dee27b2d740a273b3a3a86","name":"interactions_tenant_occurred_idx","valid":true},{"hash":"9ab02b39c0a9dcb409371595dd22b317","name":"interactions_tenant_person_idx","valid":true},{"hash":"9026abb0805ac33730d78a21bdc85364","name":"interactions_tenant_processing_idx","valid":true},{"hash":"60847df577987b97a1aa8e49893f6740","name":"interactions_tenant_type_occurred_idx","valid":true},{"hash":"cfa31edad77dc169ce86ec6f0bb18c10","name":"interactions_tenant_type_source_idx","valid":true}],"forceRls":false,"policies":[{"name":"interactions_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"3b4c64fd9157e1dab30e91b351a56128","name":"interactions_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"interactions_pkey","validated":true},{"hash":"2e6cb81b96ef1f338484943fdb13da96","kind":"f","name":"interactions_related_campaign_fk","validated":true},{"hash":"2dc4fa1294c5cf8d6796d8b4c37f0fa0","kind":"u","name":"interactions_tenant_id_source_table_source_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"jobs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_system","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"external_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_number","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"customer_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"customer_company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"site_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"engineer_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"title","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_type","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"invoice_status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"quote_status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"value_pennies","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"booked_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"completed_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"active","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ee37b3b19e0eb6a9ec843fb638bb846b"},{"name":"verified","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"e2b5d04060b50f96e02ff49b339ed40c","name":"jobs_number_uk","valid":true},{"hash":"47262421c727307ac344956cf7d14923","name":"jobs_pkey","valid":true},{"hash":"e34e04d2ff2d6c0312b227bd2c49508c","name":"jobs_source_uk","valid":true},{"hash":"cc280df5dbcf661faf07141d3eecca73","name":"jobs_tenant_customer_idx","valid":true},{"hash":"184a00fe1e8d9d8202141da43859208a","name":"jobs_tenant_idx","valid":true}],"forceRls":false,"policies":[{"name":"jobs_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"6531df5998769ed5ffb7779d6ce6dfbb","name":"jobs_set_updated_at","enabled":"O"},{"hash":"9e38c2eb0e81c9ead9a4527ff2bc657e","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"08723955dee11c6cd8edfc8398afbaa0","kind":"f","name":"jobs_customer_company_id_fkey","validated":true},{"hash":"916bf00abad8f3f94f73abdcedf20f1d","kind":"f","name":"jobs_customer_person_id_fkey","validated":true},{"hash":"e51bea4de5e209d1bec8820944969827","kind":"f","name":"jobs_engineer_person_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"jobs_pkey","validated":true},{"hash":"d17aadc9a7f4da0432796d76a1939418","kind":"f","name":"jobs_site_id_fkey","validated":true}]},{"acl":[{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"learn_member_history","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"member_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"sequence","type":"bigint","notNull":true,"identity":"a","generated":"","defaultHash":null},{"name":"kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"observed_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"c92679b3a5f2d209d86c588ae97c31ed"},{"name":"before_state","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"after_state","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"72df96e87e3d3d3316fc921eaaff57d0","name":"learn_member_history_pkey","valid":true},{"hash":"c1d65e269ac39aed6a9126b36b2a430a","name":"learn_member_history_read_idx","valid":true},{"hash":"33e9f88ce9e14747a80e889d47662cbe","name":"learn_member_history_sequence_key","valid":true}],"forceRls":false,"policies":[],"triggers":[{"hash":"c5c651e8a1efc1dbc5aa64dce37fa5e7","name":"learn_member_history_immutable","enabled":"O"},{"hash":"35ad62dbcb8f8f310438a13b72f70dd6","name":"learn_member_history_no_truncate","enabled":"O"}],"constraints":[{"hash":"79e945251558ca350deea80ac4f60590","kind":"c","name":"learn_member_history_after_state_check","validated":true},{"hash":"45acaf4fe70eb8c55bcef7008c0dac8f","kind":"c","name":"learn_member_history_before_state_check","validated":true},{"hash":"a320b2ed3237abc023ca288e600f6b24","kind":"c","name":"learn_member_history_check","validated":true},{"hash":"2d4aacb1742e3f7eeefb6fc3e70f8ebf","kind":"c","name":"learn_member_history_kind_check","validated":true},{"hash":"94f31b9e39db04adb90cf1d958593e6d","kind":"f","name":"learn_member_history_member_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"learn_member_history_pkey","validated":true},{"hash":"535afaf2408875eb2288aafe16c92b6e","kind":"u","name":"learn_member_history_sequence_key","validated":true},{"hash":"6640173aadc2390c2c2c19d76af2a4f2","kind":"f","name":"learn_member_history_tenant_id_fkey","validated":true}]},{"acl":[{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"SELECT"}],"rls":true,"name":"learn_performance_reviews","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"measurement_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"revision","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"decision","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"reviewed_by","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"reason","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"c92679b3a5f2d209d86c588ae97c31ed"}],"indexes":[{"hash":"f0901f6432b85702f3defdee4152d051","name":"learn_performance_reviews_measurement_id_revision_key","valid":true},{"hash":"cdcdbbb67989e914a5c90b5394398d32","name":"learn_performance_reviews_pkey","valid":true}],"forceRls":false,"policies":[{"name":"learn_performance_review_read","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"38a873c86f71aced355eaf609480c9d8","permissive":"PERMISSIVE"}],"triggers":[{"hash":"e50379f76ee5d16634fd83a6d8f4cbd4","name":"learn_measurement_reference_guard","enabled":"O"},{"hash":"8981780a41518dc6e85ed63e19c1e0ca","name":"learn_performance_reviews_immutable","enabled":"O"},{"hash":"166a243c4da43cfa7d590ac5c6b4bbf7","name":"learn_performance_reviews_no_truncate","enabled":"O"}],"constraints":[{"hash":"4e3ce74f119b25ddff546cc99ed144a8","kind":"c","name":"learn_performance_reviews_decision_check","validated":true},{"hash":"0dabdaca8cb5046742cbc942fc18d03d","kind":"f","name":"learn_performance_reviews_measurement_id_fkey","validated":true},{"hash":"761187cbdd8c89592b0b3e883c9ac599","kind":"u","name":"learn_performance_reviews_measurement_id_revision_key","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"learn_performance_reviews_pkey","validated":true},{"hash":"83686f2bb66804a53b0f5b40db5aed83","kind":"c","name":"learn_performance_reviews_reason_check","validated":true},{"hash":"e1a9d37ce39dc33fb256a1f32ed1135f","kind":"f","name":"learn_performance_reviews_reviewed_by_fkey","validated":true},{"hash":"27243795341cf9da4287f90413a06c79","kind":"c","name":"learn_performance_reviews_revision_check","validated":true},{"hash":"6640173aadc2390c2c2c19d76af2a4f2","kind":"f","name":"learn_performance_reviews_tenant_id_fkey","validated":true}]},{"acl":[{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"learn_scorecard_publications","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"version_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"policy_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"revision","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"scope","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"published_by","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"effective_from","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"reason","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"policy","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"f8286263866a8b78ac71fc3f137b2fa8","name":"learn_scorecard_publications_pkey","valid":true},{"hash":"9c83b4f6567acf945172062d504d5115","name":"learn_scorecard_publications_tenant_id_policy_id_revision_key","valid":true},{"hash":"778720668427c1141c374017898d78d4","name":"learn_scorecard_publications_tenant_id_scope_effective_from_key","valid":true},{"hash":"cb77e0ebe7da8cd8fab1add121593f57","name":"learn_scorecard_publications_version_id_key","valid":true}],"forceRls":false,"policies":[{"name":"learn_scorecard_publications_read","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"38a873c86f71aced355eaf609480c9d8","permissive":"PERMISSIVE"}],"triggers":[{"hash":"18d81e7c83a475552a803de0ec9a3186","name":"learn_scorecard_publications_immutable","enabled":"O"},{"hash":"9f44792b5c8a6cd0ef01fcf84862e186","name":"learn_scorecard_publications_no_truncate","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"learn_scorecard_publications_pkey","validated":true},{"hash":"da014df845a5c50ee8e66878de61e4c7","kind":"c","name":"learn_scorecard_publications_policy_check","validated":true},{"hash":"83686f2bb66804a53b0f5b40db5aed83","kind":"c","name":"learn_scorecard_publications_reason_check","validated":true},{"hash":"27243795341cf9da4287f90413a06c79","kind":"c","name":"learn_scorecard_publications_revision_check","validated":true},{"hash":"6640173aadc2390c2c2c19d76af2a4f2","kind":"f","name":"learn_scorecard_publications_tenant_id_fkey","validated":true},{"hash":"4c851856243793d3345456ed08ee56fd","kind":"u","name":"learn_scorecard_publications_tenant_id_policy_id_revision_key","validated":true},{"hash":"8f1f0953c4b5da850575db92be5922c4","kind":"u","name":"learn_scorecard_publications_tenant_id_scope_effective_from_key","validated":true},{"hash":"97cb98cd5af49c086e8e9067cad15aaf","kind":"f","name":"learn_scorecard_publications_version_id_fkey","validated":true},{"hash":"8dd6b52813dd945356f94f94e55be34f","kind":"u","name":"learn_scorecard_publications_version_id_key","validated":true}]},{"acl":[{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"learn_work_measurement_runs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"member_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"actor_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"request","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"observed_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_system","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"5bb897ec929ffb7ce0e6b1f062c58b3b"},{"name":"metric_key","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"25bd30f127e5064f0869f00703597b2e"},{"name":"explanation","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"proof","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"bbec0b0bfd7f4bc82d052bff801b89da","name":"learn_work_measurement_runs_pkey","valid":true}],"forceRls":false,"policies":[{"name":"learn_work_measurement_runs_read","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"38a873c86f71aced355eaf609480c9d8","permissive":"PERMISSIVE"}],"triggers":[{"hash":"e2f7b3cd01d2efaa9394aa40d5aabb7d","name":"learn_work_measurement_runs_immutable","enabled":"O"},{"hash":"03fccb0fae7bf801f3a8c0a02d12d3e5","name":"learn_work_measurement_runs_no_truncate","enabled":"O"},{"hash":"9e244a2e545500de944887c01e3af24a","name":"learn_work_receipt_reference_guard","enabled":"O"}],"constraints":[{"hash":"0519801dd2b0dba41c831224ed4b72cd","kind":"f","name":"learn_work_measurement_actor_fkey","validated":true},{"hash":"94f31b9e39db04adb90cf1d958593e6d","kind":"f","name":"learn_work_measurement_runs_member_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"learn_work_measurement_runs_pkey","validated":true},{"hash":"50899ee70ed2873e4bf81938e541b97a","kind":"c","name":"learn_work_measurement_runs_proof_check","validated":true},{"hash":"6640173aadc2390c2c2c19d76af2a4f2","kind":"f","name":"learn_work_measurement_runs_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"measurements","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"metric_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"value","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"unit","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"currency","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"window_start","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"window_end","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"measured_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"source","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"calculation_method","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"freshness","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"milestone_reached","type":"boolean","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"subject_kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"41e7f161a1b3d8ad3233f0e346a36955"},{"name":"subject_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"policy_version_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"policy_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"policy_revision","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metric_key","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"sample_count","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"covered_count","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"eligible_count","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source_through","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"review_state","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"exclusions","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"supersedes","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"group_ids","type":"uuid[]","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"request_payload","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"change_reason","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"6bef1e5d8bd1877af9377888ccca2edc","name":"measurements_one_correction","valid":true},{"hash":"d379fb48ae5a30d56f378d955db2691e","name":"measurements_performance_series","valid":true},{"hash":"19f260de653ff2cd2d947fe48aea59ef","name":"measurements_pkey","valid":true},{"hash":"52f4ab40df343700f02d6bce523da631","name":"measurements_series","valid":true}],"forceRls":false,"policies":[{"name":"measurements_performance_read","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"775639f9a5fdb3f2bc4eca1a67badce2","permissive":"RESTRICTIVE"},{"name":"measurements_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"139ca0d3e6ecacce465de8434f7e68eb","name":"learn_measurement_reference_guard","enabled":"O"},{"hash":"b8df43d89fc8c277334e2e3e1e79c53a","name":"learn_measurement_scope_guard","enabled":"O"},{"hash":"8e8950fab4e8c52189ee4663dc2d8c39","name":"learn_measurements_no_truncate","enabled":"O"},{"hash":"f6a9ef640df7506fe41a4e215b7b8083","name":"learn_performance_insert_guard","enabled":"O"},{"hash":"c3b15733f04f3be83febc5d0fc899b29","name":"measurements_no_delete","enabled":"O"},{"hash":"21b2ab9e4b71b511e65213a43cbbcf8e","name":"measurements_no_update","enabled":"O"}],"constraints":[{"hash":"d3fe51859e3d1856b9c17f4f1e41a3ab","kind":"f","name":"measurements_metric_id_fkey","validated":true},{"hash":"4ede3f45412713fa21df45761398b63a","kind":"c","name":"measurements_performance_shape","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"measurements_pkey","validated":true},{"hash":"a1351f6a524f02919222f0a21466d7c1","kind":"f","name":"measurements_policy_version_id_fkey","validated":true},{"hash":"dcf73ec10cb5a668256af8d0c5dacb9f","kind":"c","name":"measurements_subject_kind_check","validated":true},{"hash":"e5138b98acc32190ec153a8cb22f361d","kind":"f","name":"measurements_supersedes_fkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"measurements_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"object_state_history","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"object_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"from_state","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"to_state","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"actor","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"reason","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"decision_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"occurred_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"work_before","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"work_after","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"transition_verb","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"capture_kind","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"capture_sequence","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"e4dd772f39843ea4840616e4b4369651","name":"object_state_history_pkey","valid":true},{"hash":"02081c539f0f477bb6aba6bb6ab18f0b","name":"osh_capture_read","valid":true},{"hash":"eb68666fc8eaeb9a9dac4090c8a9e5ba","name":"osh_capture_sequence","valid":true},{"hash":"98e163f583b8ae11499933a37ef28af4","name":"osh_object","valid":true},{"hash":"0a48bbf1a5dca8b9863d7a0ad1e9a75e","name":"osh_work_snapshot_lookup","valid":true}],"forceRls":false,"policies":[{"name":"osh_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"df778357df349262fc1f60ebd435c3a1","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"ff84cf30e416b9d536144481f4cf6495","name":"learn_work_history_immutable","enabled":"O"},{"hash":"243abad39de7ae27d411efe295d5439a","name":"learn_work_history_no_truncate","enabled":"O"}],"constraints":[{"hash":"efecd18ba36d7d20042cee469dff8f6a","kind":"c","name":"object_state_history_capture_kind_check","validated":true},{"hash":"506e57bbdbee163754b18e2781fe4b79","kind":"f","name":"object_state_history_object_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"object_state_history_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"object_state_history_tenant_id_fkey","validated":true},{"hash":"dcd5986e4cfd07a7b9a58a669ac1e700","kind":"c","name":"osh_capture_shape","validated":true},{"hash":"ffc7c3acdb4530bc3309cbd96c795d18","kind":"c","name":"osh_work_snapshot_pair","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"operating_profile_entries","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"scope_kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"scope_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"domain","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"namespace","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"key","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"value","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"version_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"f7112da5b3e810c615fb4248a4171cc7","name":"learn_scorecard_revision_identity","valid":true},{"hash":"80276b3f0ac260d9ffc783ea4ef16807","name":"ope_lookup","valid":true},{"hash":"2357e775e69d23c4124847e725a3a43b","name":"ope_natural_uk","valid":true},{"hash":"33d3ef6583191ba499ebe24389e25697","name":"ope_scope","valid":true},{"hash":"b5183f0b5442ee13b9b0098f464e20e5","name":"operating_profile_entries_pkey","valid":true}],"forceRls":false,"policies":[{"name":"ope_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"4da561cf20b60ddd6d041662476ff459","permissive":"PERMISSIVE"}],"triggers":[{"hash":"620bab25b98636b2d1cbf2bc76e734f4","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"3fe31151c20ef8956d721f8e0edcc1d4","name":"learn_scorecard_entries_no_truncate","enabled":"O"},{"hash":"d6ebc72980c3ac0436fc62829661dbf8","name":"learn_scorecard_revision_immutable","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"operating_profile_entries_pkey","validated":true},{"hash":"383030d3ba7a7f663f660fb950270f35","kind":"c","name":"operating_profile_entries_scope_kind_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"operating_profile_entries_tenant_id_fkey","validated":true},{"hash":"97cb98cd5af49c086e8e9067cad15aaf","kind":"f","name":"operating_profile_entries_version_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"org_units","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"parent_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"977befb3251c01656fc9bf6c7d98e947","name":"org_units_id_tenant_uk","valid":true},{"hash":"89c7906b33ff47cfa0c22c491aa601bd","name":"org_units_pkey","valid":true},{"hash":"9ad08482ebb4aec4838a12c279cb7567","name":"org_units_tenant","valid":true}],"forceRls":false,"policies":[{"name":"org_units_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"05a71fc442922c364f5b8b415e6c80ec","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"dc2a972fad8ade815a16649ad7632e74","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"10515e6a015c6f4e3fe0ae000c44e665","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"d5cfd4d30554ccb75b30b8ef9a34e9d4","name":"org_units_set_updated_at","enabled":"O"}],"constraints":[{"hash":"d5fcca4b41cda0d74e531fcdd52cfa71","kind":"f","name":"org_units_parent_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"org_units_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"org_units_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"phone_calls","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"8635fd7ef6f459e4bf239c48fc2077a6"},{"name":"provider_call_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"linked_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"direction","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_number","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"to_number","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"duration_seconds","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"outcome","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"cost","type":"numeric(12,4)","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"raw_payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"ad06f1828a4b92c109adb1f762c295e3","name":"phone_calls_feed_idx","valid":true},{"hash":"041a21ecbe4a029507ed2f7077d990ef","name":"phone_calls_from_number_idx","valid":true},{"hash":"ea8afbddb27a43baff209fb09069515d","name":"phone_calls_linked_id_idx","valid":true},{"hash":"aa6bc6fbd4a69f5048ec6912e1af7d76","name":"phone_calls_pkey","valid":true},{"hash":"07dd19ebb1744536c0e4fecc4ecd33e8","name":"phone_calls_started_at_idx","valid":true},{"hash":"1a4214891dce0f770f8c49b1a78faaf6","name":"phone_calls_tenant_id_idx","valid":true},{"hash":"8743c824e2d12b7edb49176233d498fa","name":"phone_calls_tenant_id_provider_provider_call_id_key","valid":true}],"forceRls":false,"policies":[{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"},{"name":"phone_calls_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"8f5a3046c7ffdc57f3903d1c00bf7231","name":"phone_calls_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"phone_calls_pkey","validated":true},{"hash":"93e9bfc0ac59cbc413c644fe7309a0ea","kind":"u","name":"phone_calls_tenant_id_provider_provider_call_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"phone_recordings","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"8635fd7ef6f459e4bf239c48fc2077a6"},{"name":"provider_recording_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"provider_call_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"linked_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"recording_uri","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"file_size","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"duration_seconds","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"storage_path","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"raw_payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"e9b8cb4fa73612656b762a0dba9c2733","name":"phone_recordings_feed_idx","valid":true},{"hash":"984f7e1f561e0692b066ac1595709bbc","name":"phone_recordings_pkey","valid":true},{"hash":"72d3cb038f69fcae71277ac20c30881b","name":"phone_recordings_provider_call_id_idx","valid":true},{"hash":"79c1b0d656c6d1bb7be6450e453758dd","name":"phone_recordings_tenant_id_idx","valid":true},{"hash":"51f2ebc8c93acd85ebe42f2eac97d331","name":"phone_recordings_tenant_id_provider_provider_recording_id_key","valid":true}],"forceRls":false,"policies":[{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"},{"name":"phone_recordings_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"118396f378009025373f5159a2b2e09e","name":"phone_recordings_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"phone_recordings_pkey","validated":true},{"hash":"1264fb8f6704b74ca974958dc202fdaa","kind":"u","name":"phone_recordings_tenant_id_provider_provider_recording_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"profiles","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"full_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"role","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ebe5151db32cb9795191097a4f9511a9"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"b7142bbffc23de763c1bd9f00489ec05","name":"profiles_pkey","valid":true},{"hash":"c07a523f1ebc968ab6b32bd5c984f32b","name":"profiles_role_idx","valid":true},{"hash":"610436088a5788625dd6956b9059f8c9","name":"profiles_tenant_id_idx","valid":true},{"hash":"84b975915f84814cf35c7604d4f94ecf","name":"profiles_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"learn_launch_metadata_profile","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"RESTRICTIVE"},{"name":"profiles_select_own","roles":["public"],"command":"SELECT","checkHash":null,"usingHash":"bc9c729a84690340789a4e4f01175335","permissive":"PERMISSIVE"}],"triggers":[{"hash":"bb3752d7064fd9e06fbe457f475928cc","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"83b0936855bf3bb7daa4f8356eb3c926","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"8a97ecad600d272e906bb06dea0b91c4","name":"profiles_set_updated_at","enabled":"O"}],"constraints":[{"hash":"0061c9fb3a9abcf2edbcd4a42467a9c3","kind":"f","name":"profiles_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"profiles_pkey","validated":true},{"hash":"4b3bd90c7f38a26788aecebbe2479ad7","kind":"c","name":"profiles_role_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"team_members","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"profile_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"org_unit_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"formal_role","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"observed_role","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"observed_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"c52f9c62eaaccb25ee4a31f5d7985d5f"},{"name":"authority_level","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"af8c0c74e3183c2818bc9d953905fd3b"},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"dc1aa1465ec03c693f1c71ed37ae624c"},{"name":"confirmed_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confirmed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"effective_from","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"effective_to","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"version","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"c4ca4238a0b923820dcc509a6f75849b"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"702f51d0616b95af6acceac770041d90","name":"team_members_id_tenant_uk","valid":true},{"hash":"3050f5b55154f2c1f333d5ac4620ed9f","name":"team_members_pkey","valid":true},{"hash":"4c7c3c5008c60803c6e0cdc1c63d4724","name":"team_members_profile","valid":true},{"hash":"d1291cf097138ed6a8e370ba09879e2c","name":"team_members_tenant","valid":true}],"forceRls":false,"policies":[{"name":"team_members_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"20470c2fa4bfa1cfd511bff609c9327a","name":"learn_capture_member_change","enabled":"O"},{"hash":"1f88777e8f895faa6f75f677f577a205","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"81116ed1f8bd3359a358eb8c192755eb","name":"learn_member_no_delete","enabled":"O"},{"hash":"4903df4fb40be1ac178cfdf9148826be","name":"learn_member_no_truncate","enabled":"O"},{"hash":"d45827f37e95f2ee646f5f6fa087fd33","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"d436df6318ac765e417b873eaff97451","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"b419d5db1c118ff5d4e1f4a175ef311a","name":"team_members_set_updated_at","enabled":"O"}],"constraints":[{"hash":"ff1dd41640b0c5def6891c12630f5f29","kind":"c","name":"team_members_authority_level_check","validated":true},{"hash":"fe05d9f5fdc7c955f732c72e312b120c","kind":"c","name":"team_members_confidence_check","validated":true},{"hash":"0b3438f4f2c60569832a789b448f8a4d","kind":"c","name":"team_members_observed_status_check","validated":true},{"hash":"c773fa58011794721f1db6b5021ef422","kind":"f","name":"team_members_org_unit_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"team_members_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"team_members_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"tenants","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"slug","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"industry","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"5284b9c618f8618b72a402ea2c593753","name":"tenants_pkey","valid":true},{"hash":"6260c986ce2d58a0ad3de3f74ec6eb6f","name":"tenants_slug_key","valid":true}],"forceRls":false,"policies":[{"name":"tenants_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"831f798d620de1d73971187d41079b4d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"8009f8efa07661ab809d3f9e077da55e","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"742cd63e2f0ed7809f0911b17d02869d","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"8a4d62ca55c88b97023eab7696e527ce","name":"tenants_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"tenants_pkey","validated":true},{"hash":"687397275d0e852fb2a4b50394adffee","kind":"u","name":"tenants_slug_key","validated":true},{"hash":"7702cc7b97df1ebce81e13bb05db5c2d","kind":"c","name":"tenants_status_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"view_as_context","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"actor_user_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_ref","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"mode","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d3f83345a22c6bbd79692e353599f18"},{"name":"read_only","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"reason","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"expires_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"dae782846028bc8168db98a8dd4b9193"},{"name":"ended_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"5325064a8cf3f1e500b2308ea36b3343","name":"view_as_actor","valid":true},{"hash":"3b4560fae7e0f79297469f029ab77627","name":"view_as_context_pkey","valid":true}],"forceRls":false,"policies":[{"name":"view_as_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"565594dabafccb3adbde49e7a3f8790a","permissive":"PERMISSIVE"}],"triggers":[{"hash":"aaf4c57e4c5a9674a6979f95139e4746","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"1b0ebc4a05c69edafb63e927ba619765","name":"learn_work_authority_truncate_lock","enabled":"O"}],"constraints":[{"hash":"db8d41fae95b78d4a530a37cc023f719","kind":"c","name":"view_as_context_mode_check","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"view_as_context_pkey","validated":true},{"hash":"9579aceb86350661ce8f9dd1b4211a9b","kind":"c","name":"view_as_context_subject_kind_check","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"view_as_context_tenant_id_fkey","validated":true}]}]'::jsonb then raise exception 'Production scoring table baseline differs';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name' like 'learn_%' or f->>'name' in ('current_tenant_id','current_user_role','objectives_append_only');
 if actual_helpers is distinct from '[{"hash":"58873c19368521e21e846890ee429301","name":"current_tenant_id","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":true},{"hash":"760512ca1d1f925421f3faf36e9d4447","name":"current_user_role","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":true},{"hash":"f27c303fa272e56a19811441bff5a10d","name":"learn_capture_member_change","owner":"postgres","arguments":"","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":false},{"hash":"ebe22f602faa74f7f3df12d93583e883","name":"learn_capture_work_change","owner":"postgres","arguments":"","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":false},{"hash":"c42b841a4e53ba5ba7580f340c9bd465","name":"learn_foundation_reference_guard","owner":"postgres","arguments":"","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"bfca82faf4e9c3138de7ab06a6478f86","name":"learn_handoff_owner","owner":"postgres","arguments":"p_tenant uuid, p_roster jsonb, p_ref jsonb, p_at timestamp with time zone","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":false},{"hash":"08dd61510e9c52c8a325f3fae3f25601","name":"learn_member_capture_baseline","owner":"postgres","arguments":"p_tenant uuid, p_member uuid","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"de311180659602e72fcb939088eda2a7","name":"learn_member_group_covers","owner":"postgres","arguments":"p_tenant uuid, p_member uuid, p_group uuid, p_start timestamp with time zone, p_end timestamp with time zone","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":false},{"hash":"90407b588640ab0b3bf89b6e1eacc72c","name":"learn_member_history_immutable","owner":"postgres","arguments":"","anonExecute":false,"serviceExecute":false,"securityDefiner":false,"authenticatedExecute":false},{"hash":"4bccfdd55f5080f797534899d93e964a","name":"learn_member_history_read","owner":"postgres","arguments":"p_tenant uuid, p_start timestamp with time zone, p_end timestamp with time zone","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true},{"hash":"97aae7a9ead3fa35fdfc9cbbddb30b15","name":"learn_member_snapshot","owner":"postgres","arguments":"p team_members","anonExecute":false,"serviceExecute":false,"securityDefiner":false,"authenticatedExecute":false},{"hash":"27f79c1007705cd524356fe8837c0597","name":"learn_metric_scope_guard","owner":"postgres","arguments":"","anonExecute":false,"serviceExecute":false,"securityDefiner":false,"authenticatedExecute":false},{"hash":"3516b3af40afab8125706dc41b194cb4","name":"learn_performance_append","owner":"postgres","arguments":"p_tenant_id uuid, p_measurement jsonb, p_reason text","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"170ce26c8a824461ad26da0ed3a9f3fc","name":"learn_performance_insert_guard","owner":"postgres","arguments":"","anonExecute":false,"serviceExecute":false,"securityDefiner":false,"authenticatedExecute":false},{"hash":"89c2ba91df3869f3750b8ddb1e149995","name":"learn_performance_review","owner":"postgres","arguments":"p_tenant_id uuid, p_measurement_id uuid, p_request_id uuid, p_expected_revision integer, p_decision text, p_reason text","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true},{"hash":"c7f014760979e79fa6828a0f37c0920d","name":"learn_scorecard_policy_for_period","owner":"postgres","arguments":"p_tenant uuid, p_kind text, p_group uuid, p_start timestamp with time zone, p_end timestamp with time zone","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true},{"hash":"56179d1a81596506fd2b68801cb3ad17","name":"learn_scorecard_publish","owner":"postgres","arguments":"p_tenant uuid, p_policy uuid, p_revision integer, p_request uuid, p_reason text","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true},{"hash":"4810627b5ca1b4576dfc06bbbc08d1f8","name":"learn_scorecard_read_draft","owner":"postgres","arguments":"p_tenant uuid, p_kind text, p_group uuid","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true},{"hash":"5d1fc874894426ad8f3ec83922e891e6","name":"learn_scorecard_revision_immutable","owner":"postgres","arguments":"","anonExecute":false,"serviceExecute":false,"securityDefiner":false,"authenticatedExecute":false},{"hash":"65ff14a5e65a21f1ce6614e20e90bf7a","name":"learn_scorecard_save_draft","owner":"postgres","arguments":"p_tenant_id uuid, p_expected_version integer, p_definition jsonb, p_reason text","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true},{"hash":"3b6a964a55ca3adbc512418727b7025d","name":"learn_work_authority","owner":"postgres","arguments":"p_tenant uuid, p_object uuid, p_actor uuid, p_target_member uuid, p_claim boolean","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"af8b2a64b8dec200f18ab9750b088fe7","name":"learn_work_authority_input_lock","owner":"postgres","arguments":"","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":false},{"hash":"18da3fb5c3e698f57cf86fb85381e435","name":"learn_work_capture_baseline","owner":"postgres","arguments":"p_tenant uuid, p_object uuid","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"b1a8908fe99097c7390469d865f3a6e3","name":"learn_work_cover_day","owner":"postgres","arguments":"p_mask integer, p_timezone text, p_at timestamp with time zone","anonExecute":false,"serviceExecute":false,"securityDefiner":false,"authenticatedExecute":false},{"hash":"1ed3d30a9f435646eb922a7bdf855c65","name":"learn_work_handoffs_collect","owner":"postgres","arguments":"p_tenant uuid, p_member uuid, p_policy uuid, p_revision integer, p_start timestamp with time zone, p_end timestamp with time zone, p_request uuid, p_reason text","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true},{"hash":"9963997bb98d8fc52722799e2b38230e","name":"learn_work_history_immutable","owner":"postgres","arguments":"","anonExecute":false,"serviceExecute":false,"securityDefiner":false,"authenticatedExecute":false},{"hash":"d04e81a90265bee2395c55978be79ba3","name":"learn_work_history_read","owner":"postgres","arguments":"p_tenant uuid, p_object uuid, p_start timestamp with time zone, p_end timestamp with time zone","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true},{"hash":"e59bbf00dd0663fcacaf719340826aab","name":"learn_work_registry_input_lock","owner":"postgres","arguments":"","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":false},{"hash":"165b350e344947ebc1a01cce3da440fc","name":"learn_work_residence_collect","owner":"postgres","arguments":"p_tenant uuid, p_member uuid, p_policy uuid, p_revision integer, p_start timestamp with time zone, p_end timestamp with time zone, p_request uuid, p_reason text","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true},{"hash":"bfc86e3ad28174d64a46ff852d619c8a","name":"learn_work_snapshot","owner":"postgres","arguments":"p intelligence_objects","anonExecute":false,"serviceExecute":false,"securityDefiner":false,"authenticatedExecute":false},{"hash":"4ae8319a887f1e1905b47cdd220c2bed","name":"objectives_append_only","owner":"postgres","arguments":"","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true}]'::jsonb then raise exception 'Production scoring helper baseline differs';end if;
end $$;
-- SOURCE supabase/migrations/20261031020000_learn_performance_corrections.sql
-- Manager numerical corrections retain originals, source freshness and independent review.

create table public.learn_performance_corrections (
 id uuid primary key references public.measurements(id),
 tenant_id uuid not null references public.tenants(id),
 predecessor_id uuid not null unique references public.measurements(id),
 previous_value numeric,
 corrected_value numeric,
 source_observed_at timestamptz not null,
 expected_review_revision integer not null check(expected_review_revision>=0 and expected_review_revision<2147483647),
 corrected_by uuid not null references public.profiles(id),
 reason text not null check(length(btrim(reason)) between 1 and 1000),
 created_at timestamptz not null,
 check(isfinite(source_observed_at) and isfinite(created_at) and source_observed_at<=created_at),
 check(previous_value is distinct from corrected_value)
);
alter table public.learn_performance_corrections enable row level security;
create policy learn_performance_correction_read on public.learn_performance_corrections for select to authenticated
 using(tenant_id=public.current_tenant_id() and coalesce(public.current_user_role(),'') in ('owner','admin'));
revoke all on public.learn_performance_corrections from public,anon,authenticated,service_role;
grant select on public.learn_performance_corrections to authenticated,service_role;
create trigger learn_performance_correction_immutable before update or delete on public.learn_performance_corrections
 for each row execute function public.objectives_append_only();
create trigger learn_performance_correction_no_truncate before truncate on public.learn_performance_corrections
 for each statement execute function public.objectives_append_only();

create function public.learn_performance_correct(p_tenant uuid,p_measurement uuid,p_request uuid,p_expected_review_revision integer,p_value numeric,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 actor_tenant uuid;actor_role text;
 parent public.measurements%rowtype;
 prior public.learn_performance_corrections%rowtype;
 previous_correction public.learn_performance_corrections%rowtype;
 current_revision integer;observed timestamptz;source_observed timestamptz;payload jsonb;receipt jsonb;
begin
 select p.tenant_id,p.role into actor_tenant,actor_role from public.profiles p where p.id=auth.uid() for share;
 if auth.uid() is null or actor_tenant is distinct from p_tenant or coalesce(actor_role,'') not in ('owner','admin')
 or exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'Company owner/admin access required outside preview' using errcode='42501';end if;
 if p_tenant is null or p_measurement is null or p_request is null or p_expected_review_revision is null
 or p_expected_review_revision<0 or p_expected_review_revision>=2147483647
 or length(btrim(coalesce(p_reason,''))) not between 1 and 1000
 or (p_value is not null and (p_value::text in ('NaN','Infinity','-Infinity') or abs(p_value)>1.7976931348623157e308)) then
  raise exception 'A measurement, finite value or withheld value, current review revision and reason are required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-performance-correction:'||p_request::text,0));
 select * into prior from public.learn_performance_corrections where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.predecessor_id<>p_measurement or prior.corrected_by<>auth.uid()
   or prior.expected_review_revision<>p_expected_review_revision or prior.corrected_value is distinct from p_value or prior.reason<>btrim(p_reason) then
   raise exception 'Correction request identity changed' using errcode='PT409';end if;
  return jsonb_build_object('measurementId',prior.id,'predecessorId',prior.predecessor_id,'reused',true);
 end if;
 select * into parent from public.measurements where id=p_measurement and tenant_id=p_tenant for update;
 if not found or parent.subject_kind='tenant' or parent.request_payload is null then
  raise exception 'Performance observation unavailable' using errcode='22023';end if;
 if exists(select 1 from public.measurements where supersedes=parent.id) then
  raise exception 'Observation already corrected; reload the card' using errcode='PT409';end if;
 select coalesce(max(revision),0) into current_revision from public.learn_performance_reviews where measurement_id=parent.id;
 if current_revision<>p_expected_review_revision then raise exception 'Review changed; reload the card' using errcode='PT409';end if;
 if parent.value is not distinct from p_value then raise exception 'Correction must change or withhold the value' using errcode='22023';end if;
 source_observed:=parent.measured_at;
 if parent.request_payload ? 'manualCorrectionId' then
  select * into previous_correction from public.learn_performance_corrections where id=parent.id and tenant_id=p_tenant;
  if not found or parent.request_payload->>'manualCorrectionId' is distinct from parent.id::text
   or previous_correction.predecessor_id is distinct from parent.supersedes or previous_correction.corrected_value is distinct from parent.value then
   raise exception 'Correction provenance is incomplete' using errcode='PT409';end if;
  source_observed:=previous_correction.source_observed_at;
 end if;
 observed:=clock_timestamp();
 if date_trunc('milliseconds',observed)<=date_trunc('milliseconds',parent.measured_at) then
  raise exception 'Observation is too recent; retry after reloading' using errcode='PT409';end if;
 -- Only the value and correction identity change. Counts, source watermark,
 -- unit, scope, evidence and exclusions remain those of the retained parent.
 payload:=parent.request_payload||jsonb_build_object('id',p_request,'supersedes',parent.id,'value',p_value,'observedAt',observed,'review','inferred','manualCorrectionId',p_request);
 receipt:=public.learn_performance_append(p_tenant,payload,btrim(p_reason));
 if receipt->>'measurementId' is distinct from p_request::text or receipt->>'reused' is distinct from 'false' then
  raise exception 'Correction append receipt differs' using errcode='PT409';end if;
 insert into public.learn_performance_corrections(id,tenant_id,predecessor_id,previous_value,corrected_value,source_observed_at,expected_review_revision,corrected_by,reason,created_at)
 values(p_request,p_tenant,parent.id,parent.value,p_value,source_observed,p_expected_review_revision,auth.uid(),btrim(p_reason),observed);
 return jsonb_build_object('measurementId',p_request,'predecessorId',parent.id,'reused',false);
end $$;
revoke all on function public.learn_performance_correct(uuid,uuid,uuid,integer,numeric,text) from public,anon,service_role;
grant execute on function public.learn_performance_correct(uuid,uuid,uuid,integer,numeric,text) to authenticated;

-- SOURCE supabase/migrations/20261031040000_learn_saved_assessments.sql
-- Retain canonical scoring inputs under published rules. Clients never submit scores.

create table public.learn_assessments (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 publication_id uuid not null references public.learn_scorecard_publications(id),
 subject_kind text not null check(subject_kind in ('member','team','job','customer')),
 subject_id uuid not null,
 window_start timestamptz not null,
 window_end timestamptz not null,
 recorded_at timestamptz not null,
 recorded_by uuid not null references public.profiles(id),
 reason text not null check(length(btrim(reason)) between 1 and 1000),
 request jsonb not null,
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=2097152),
 check(isfinite(window_start) and isfinite(window_end) and window_start<window_end and window_end<=recorded_at)
);
create index learn_assessment_history on public.learn_assessments(tenant_id,subject_kind,subject_id,recorded_at desc,id);
alter table public.learn_assessments enable row level security;
revoke all on public.learn_assessments from public,anon,authenticated,service_role;
grant select on public.learn_assessments to authenticated;
create policy learn_assessments_read on public.learn_assessments for select to authenticated
 using(tenant_id=public.current_tenant_id() and coalesce(public.current_user_role(),'') in ('owner','admin'));
create function public.learn_assessment_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Saved assessments are immutable; retain and reassess' using errcode='23001';end $$;
create trigger learn_assessments_immutable before update or delete on public.learn_assessments for each row execute function public.learn_assessment_immutable();
create trigger learn_assessments_no_truncate before truncate on public.learn_assessments for each statement execute function public.learn_assessment_immutable();
revoke all on function public.learn_assessment_immutable() from public,anon,authenticated,service_role;

create function public.learn_assessment_save(p_tenant uuid,p_request uuid,p_publication uuid,p_kind text,p_subject uuid,p_group uuid,p_start timestamptz,p_end timestamptz,p_expected jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); prior learn_assessments%rowtype; policy jsonb; wanted jsonb;
 ms jsonb; rs jsonb; cs jsonb; heads jsonb; captured timestamptz; snap jsonb;
begin
 if actor is null or p_tenant is distinct from current_tenant_id() then
  raise exception 'Company owner/admin access required' using errcode='42501';end if;
 perform 1 from profiles where id=actor and tenant_id=p_tenant and role in ('owner','admin') for share;
 if not found or exists(select 1 from view_as_context where actor_user_id=actor and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'Company owner/admin access outside preview required' using errcode='42501';end if;
 if p_request is null or p_publication is null or p_subject is null or p_kind is null or p_kind not in ('member','team','job','customer')
  or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_start>=p_end or p_end>clock_timestamp() or p_end-p_start>interval '366 days'
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or jsonb_typeof(p_expected) is distinct from 'array' then
  raise exception 'Published rules, completed period, expected evidence and reason required' using errcode='22023';end if;
 if jsonb_array_length(p_expected)>500 or octet_length(p_expected::text)>65536 then
  raise exception 'Assessment evidence exceeds the current window' using errcode='22023';end if;
 wanted:=jsonb_build_object('publication',p_publication,'kind',p_kind,'subject',p_subject,'group',p_group,'start',p_start,'end',p_end,'expected',p_expected,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-assessment:'||p_request::text,0));
 select * into prior from learn_assessments where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.recorded_by<>actor or prior.request is distinct from wanted then
   raise exception 'Assessment request identity changed' using errcode='PT409';end if;
  return jsonb_build_object('assessmentId',prior.id,'recordedAt',prior.recorded_at,'reused',true);
 end if;
 policy:=learn_scorecard_policy_for_period(p_tenant,p_kind,p_group,p_start,p_end);
 if policy is null or policy#>>'{publication,id}' is distinct from p_publication::text then
  raise exception 'Published rules changed or do not cover this period' using errcode='PT409';end if;
 if (p_kind='member' and not exists(select 1 from team_members where id=p_subject and tenant_id=p_tenant))
  or (p_kind='team' and not exists(select 1 from org_units where id=p_subject and tenant_id=p_tenant))
  or (p_kind='job' and not exists(select 1 from jobs where id=p_subject and tenant_id=p_tenant))
  or (p_kind='customer' and not exists(select 1 from customer_cards where id=p_subject and tenant_id=p_tenant))
  or (p_group is not null and (p_kind not in ('member','team') or (p_kind='team' and p_subject<>p_group))) then
  raise exception 'Unknown company subject or group' using errcode='22023';end if;
 -- One MVCC statement captures all three ledgers; no client-provided values or review decisions.
 with m as materialized (
  select id,tenant_id,subject_kind,subject_id,policy_id,policy_revision,metric_key,value,unit,window_start,window_end,measured_at,source,source_through,sample_count,covered_count,eligible_count,review_state,evidence,exclusions,supersedes,group_ids,request_payload->>'manualCorrectionId' as correction_request_id
  from measurements where tenant_id=p_tenant and policy_id=(policy->>'id')::uuid and policy_revision=(policy->>'version')::int
   and subject_kind=p_kind and subject_id=p_subject and window_start=p_start and window_end=p_end order by measured_at,id limit 501
 ), r as materialized (
  select r.* from learn_performance_reviews r join m on m.id=r.measurement_id where r.tenant_id=p_tenant order by r.measurement_id,r.revision limit 1001
 ), c as materialized (
  select c.* from learn_performance_corrections c join m on m.id=c.id where c.tenant_id=p_tenant order by c.id limit 501
 ) select (select coalesce(jsonb_agg(to_jsonb(m) order by measured_at,id),'[]') from m),
  (select coalesce(jsonb_agg(to_jsonb(r) order by measurement_id,revision),'[]') from r),
  (select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from c),
  (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'reviewRevision',coalesce((select max(revision) from r where measurement_id=m.id),0)) order by m.id),'[]') from m)
 into ms,rs,cs,heads;
 if jsonb_array_length(ms)>500 or jsonb_array_length(rs)>1000 or jsonb_array_length(cs)>500 then
  raise exception 'Complete assessment evidence exceeds the current window' using errcode='22023';end if;
 if heads is distinct from p_expected then
  raise exception 'Measurements or reviews changed; reload before saving' using errcode='PT409';end if;
 if p_group is not null and p_kind='member' then
  if (jsonb_array_length(ms)=0 and not learn_member_group_covers(p_tenant,p_subject,p_group,p_start,p_end))
   or exists(select 1 from jsonb_array_elements(ms) m where not coalesce(m->'group_ids' @> jsonb_build_array(p_group),false)) then
   raise exception 'Observed team attribution does not cover this assessment' using errcode='22023';end if;
 end if;
 captured:=clock_timestamp();
 snap:=jsonb_build_object('version','learn-assessment/1','engine','learn-scorecards/1','policy',policy,
  'subject',jsonb_build_object('kind',p_kind,'id',p_subject,'groupIds',case when p_group is null then '[]'::jsonb else jsonb_build_array(p_group) end),
  'period',jsonb_build_object('start',p_start,'end',p_end),'assessedAt',captured,'measurements',ms,'reviews',rs,'corrections',cs);
 if octet_length(snap::text)>2097152 then raise exception 'Assessment snapshot exceeds current limit' using errcode='22023';end if;
 insert into learn_assessments(id,tenant_id,publication_id,subject_kind,subject_id,window_start,window_end,recorded_at,recorded_by,reason,request,snapshot)
 values(p_request,p_tenant,p_publication,p_kind,p_subject,p_start,p_end,captured,actor,btrim(p_reason),wanted,snap);
 return jsonb_build_object('assessmentId',p_request,'recordedAt',captured,'reused',false);
end $$;
revoke all on function public.learn_assessment_save(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_assessment_save(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text) to authenticated;

-- SOURCE supabase/migrations/20261101060000_learn_assessment_recovery.sql
-- Resolve interrupted assessment saves under the same lock as the original save.
-- Cancellation retains a tombstone: a delayed request cannot create an assessment later.

create table public.learn_assessment_cancellations (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 recorded_by uuid not null references public.profiles(id),
 request jsonb not null check(jsonb_typeof(request)='object' and octet_length(request::text)<=70000),
 recorded_at timestamptz not null default clock_timestamp()
);
alter table public.learn_assessment_cancellations enable row level security;
revoke all on public.learn_assessment_cancellations from public,anon,authenticated,service_role;
create trigger learn_assessment_cancellations_immutable before update or delete on public.learn_assessment_cancellations for each row execute function public.learn_assessment_immutable();
create trigger learn_assessment_cancellations_no_truncate before truncate on public.learn_assessment_cancellations for each statement execute function public.learn_assessment_immutable();

create function public.learn_assessment_resolve(p_tenant uuid,p_request uuid,p_publication uuid,p_kind text,p_subject uuid,p_group uuid,p_start timestamptz,p_end timestamptz,p_expected jsonb,p_reason text,p_cancel boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); prior learn_assessments%rowtype; cancelled learn_assessment_cancellations%rowtype; wanted jsonb;
begin
 if actor is null or p_tenant is distinct from current_tenant_id() then
  raise exception 'Company owner/admin access required' using errcode='42501';end if;
 perform 1 from profiles where id=actor and tenant_id=p_tenant and role in ('owner','admin') for share;
 if not found or exists(select 1 from view_as_context where actor_user_id=actor and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'Company owner/admin access outside preview required' using errcode='42501';end if;
 if p_request is null or p_publication is null or p_subject is null or p_kind is null or p_kind not in ('member','team','job','customer')
  or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_start>=p_end or p_end>clock_timestamp() or p_end-p_start>interval '366 days'
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or jsonb_typeof(p_expected) is distinct from 'array' then
  raise exception 'Published rules, completed period, expected evidence and reason required' using errcode='22023';end if;
 if jsonb_array_length(p_expected)>500 or octet_length(p_expected::text)>65536 then
  raise exception 'Assessment evidence exceeds the current window' using errcode='22023';end if;
 wanted:=jsonb_build_object('publication',p_publication,'kind',p_kind,'subject',p_subject,'group',p_group,'start',p_start,'end',p_end,'expected',p_expected,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-assessment:'||p_request::text,0));
 select * into prior from learn_assessments where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.recorded_by<>actor or prior.request is distinct from wanted then
   raise exception 'Assessment request identity changed' using errcode='PT409';end if;
  return jsonb_build_object('state','recorded','tenantId',p_tenant,'actorId',actor,'assessmentId',prior.id,'recordedAt',prior.recorded_at);
 end if;
 select * into cancelled from learn_assessment_cancellations where id=p_request;
 if found then
  if cancelled.tenant_id<>p_tenant or cancelled.recorded_by<>actor or cancelled.request is distinct from wanted then
   raise exception 'Assessment request identity changed' using errcode='PT409';end if;
  return jsonb_build_object('state','cancelled','tenantId',p_tenant,'actorId',actor,'assessmentId',p_request);
 end if;
 if p_cancel is null then raise exception 'Recovery action required' using errcode='22023';end if;
 if p_cancel then
  insert into learn_assessment_cancellations(id,tenant_id,recorded_by,request) values(p_request,p_tenant,actor,wanted);
 end if;
 return jsonb_build_object('state',case when p_cancel then 'cancelled' else 'pending' end,'tenantId',p_tenant,'actorId',actor,'assessmentId',p_request);
end $$;
revoke all on function public.learn_assessment_resolve(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.learn_assessment_resolve(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text,boolean) to authenticated;

-- Preserve the existing function's identity, owner, ACL and snapshot logic.
do $patch$
declare definition text; anchor text:=$anchor$ policy:=learn_scorecard_policy_for_period(p_tenant,p_kind,p_group,p_start,p_end);$anchor$;
begin
 definition:=pg_get_functiondef('public.learn_assessment_save(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text)'::regprocedure);
 if length(definition)-length(replace(definition,anchor,''))<>length(anchor)
  or position('learn_assessment_cancellations' in definition)>0 then
  raise exception 'Unexpected assessment save definition; recovery patch not applied';
 end if;
 execute replace(definition,anchor,$replacement$ if exists(select 1 from learn_assessment_cancellations where id=p_request) then
  raise exception 'Assessment request cancelled; review evidence before a new save' using errcode='PT409';
 end if;
$replacement$||anchor);
end $patch$;

-- SOURCE supabase/migrations/20261101080000_learn_team_work_residence.sql
-- Team workload observation; source history and existing member receipts are retained.
-- Apply only through a reviewed, pinned release. This file does not activate capture.
create table public.learn_team_work_measurement_runs (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 team_id uuid not null references public.org_units(id),
 actor_id uuid not null references public.profiles(id),
 request jsonb not null,
 observed_at timestamptz not null,
 source_system text not null,
 metric_key text not null,
 explanation text not null,
 proof jsonb not null check(octet_length(proof::text)<=1048576)
);
alter table public.learn_team_work_measurement_runs enable row level security;
revoke all on public.learn_team_work_measurement_runs from public,anon,authenticated,service_role;
grant select on public.learn_team_work_measurement_runs to authenticated;
create policy learn_team_work_measurement_runs_read on public.learn_team_work_measurement_runs for select to authenticated
 using(tenant_id=current_tenant_id() and coalesce(current_user_role(),'') in ('owner','admin'));
create trigger learn_team_work_measurement_runs_immutable before update or delete on public.learn_team_work_measurement_runs
 for each row execute function public.learn_member_history_immutable();
create trigger learn_team_work_measurement_runs_no_truncate before truncate on public.learn_team_work_measurement_runs
 for each statement execute function public.learn_member_history_immutable();

-- Keep every deployed append guard; extend its one evidence allowlist only.
do $patch$ declare d text; old_list text; new_list text; begin
 select pg_get_functiondef('public.learn_performance_append(uuid,jsonb,text)'::regprocedure) into d;
 old_list:=$old$('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members','learn_work_measurement_runs')$old$;
 new_list:=$new$('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members','learn_work_measurement_runs','learn_team_work_measurement_runs')$new$;
 if array_length(string_to_array(d,old_list),1) is distinct from 2 then
   raise exception 'Unexpected performance evidence contract'; end if;
 execute replace(d,old_list,new_list);
end $patch$;

-- Source-owned elapsed item-minutes; no calendar or productivity claim.
-- Uses preserved capture history without modifying source records.
create function public.learn_team_work_residence_collect(p_tenant uuid,p_team uuid,p_policy uuid,p_revision int,
 p_start timestamptz,p_end timestamptz,p_request uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); descriptor jsonb; prior learn_team_work_measurement_runs%rowtype;
 roster jsonb; history jsonb; o intelligence_objects%rowtype; first_capture object_state_history%rowtype;
 policy jsonb; rule jsonb; ev jsonb; next_ev jsonb; owner text;
 owner_team uuid; membership_event jsonb; member_capture jsonb;
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
 if p_team is null or p_policy is null or p_request is null or p_revision is null or p_revision<1
   or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
   or p_start>=p_end or p_end>observed or p_end-p_start>interval '366 days'
   or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
   raise exception 'A team, policy, completed period and reason are required' using errcode='22023'; end if;
 descriptor:=jsonb_build_object('teamId',p_team,'policyId',p_policy,'policyVersion',p_revision,
   'start',p_start,'end',p_end,'reason',btrim(p_reason),'actorId',actor,'algorithm','team-work-residence@1');
 perform pg_advisory_xact_lock(hashtextextended('learn-work-collect:'||p_request::text,0));
 select * into prior from learn_team_work_measurement_runs where id=p_request;
 if found then
   if prior.tenant_id<>p_tenant or prior.request is distinct from descriptor then
     raise exception 'Collection request identity changed' using errcode='PT409'; end if;
   if not exists(select 1 from measurements where id=p_request and tenant_id=p_tenant) then
     raise exception 'Collection receipt is incomplete' using errcode='55000'; end if;
   return jsonb_build_object('measurementId',p_request,'reused',true);
 end if;
 perform 1 from org_units where id=p_team and tenant_id=p_tenant for share;
 if not found then raise exception 'Team not found in tenant' using errcode='22023'; end if;
 select e.value into policy from operating_profile_entries e join config_versions c on c.id=e.version_id and c.tenant_id=e.tenant_id
 where e.tenant_id=p_tenant and e.namespace='learn_scorecards' and e.scope_kind='tenant'
   and e.key like 'definition.%' and e.value->>'id'=p_policy::text and e.value->>'version'=p_revision::text
   and c.artifact_kind='learn_scorecard' and c.version=p_revision and c.status in ('draft','published');
 if policy is null or policy->>'subjectKind' is distinct from 'team'
   or (policy->>'groupId' is not null and policy->>'groupId' is distinct from p_team::text) then
   raise exception 'Choose team rules covering the selected team' using errcode='22023'; end if;
 select value into rule from jsonb_array_elements(policy->'metrics') where value->>'key'='work.team_owned_item_minutes';
 if rule is null or rule->>'unit' is distinct from 'item_minutes' or not coalesce((rule->'sourceSystems') ? 'serviceos.work.team-residence@1',false) then
   raise exception 'Policy does not define the owned item-minute measure' using errcode='22023'; end if;
 -- Serialize one observation per exact cell. Refreshes must use a separately
 -- reviewed correction workflow, not create two competing independent counts.
 perform pg_advisory_xact_lock(hashtextextended('learn-team-residence-cell:'||p_tenant::text||p_team::text||p_policy::text||p_revision::text||extract(epoch from p_start)::text||':'||extract(epoch from p_end)::text,0));
 if exists(select 1 from measurements where tenant_id=p_tenant and subject_kind='team' and subject_id=p_team
   and policy_id=p_policy and policy_revision=p_revision and metric_key='work.team_owned_item_minutes'
   and window_start=p_start and window_end=p_end) then
   raise exception 'An observation already exists for this cell; review or correct it' using errcode='PT409'; end if;
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
       -- Count an item segment once: direct team assignment OR its observed member's team.
       -- Current member rows and member score percentages never determine attribution.
       membership_event:=null; owner_team:=null;
       if owner like 'team:%' then owner_team:=substring(owner from 6)::uuid;
       else
         select m into member_capture from jsonb_array_elements(roster->'members') m
           where m->>'memberId'=substring(owner from 8);
         select e into membership_event from jsonb_array_elements(member_capture->'events') e
           where (e->>'observedAt')::timestamptz<=segment_start
           order by (e->>'sequence')::bigint desc limit 1;
         if membership_event is null or not (membership_event->'after' ? 'teamId') then
           object_complete:=false; continue;
         end if;
         owner_team:=(membership_event#>>'{after,teamId}')::uuid;
         -- An explicitly ungrouped member has known non-team ownership.
         if owner_team is null then continue; end if;

       end if;
       if not exists(select 1 from org_units where id=owner_team and tenant_id=p_tenant and created_at<=segment_start) then
         object_complete:=false; continue;
       end if;
       if owner_team<>p_team then continue; end if;
       item_minutes:=item_minutes+extract(epoch from segment_end-segment_start)/60;
       credited:=credited||jsonb_build_array(jsonb_build_object('objectId',o.id,
         'start',segment_start,'end',segment_end,'itemMinutes',extract(epoch from segment_end-segment_start)/60,
         'owner',owner,'teamId',p_team,'membershipEventId',membership_event->'id','responsible',ev#>'{after,responsible_ref}','status',ev#>'{after,status}',
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
 proof:=jsonb_build_object('contract','team-work-residence@1','population','all retained intelligence objects',
   'value',result_value,'knownItemMinutes',item_minutes,'eligibleItems',eligible,'coveredItems',covered,
   'incompleteObjectIds',issues,'items',items,'credited',credited,'membership',roster);
 if octet_length(proof::text)>1048576 then raise exception 'Calculation evidence exceeds retention limit' using errcode='54000'; end if;
 if exists(select 1 from view_as_context where actor_user_id=actor and ended_at is null
   and (expires_at is null or expires_at>clock_timestamp())) then
   raise exception 'View-As cannot collect performance observations' using errcode='42501'; end if;
 insert into learn_team_work_measurement_runs(id,tenant_id,team_id,actor_id,request,observed_at,explanation,proof,source_system,metric_key)
 values(p_request,p_tenant,p_team,actor,descriptor,observed,
   'Team-owned elapsed item-minutes from direct team assignments and observed member affiliations, across all recorded states including waiting and closed states. Concurrent items add separately; this is not working hours, speed or productivity. One item is counted once per segment. No business calendar, delay exclusion or averaging of member scores applied. '
   ||covered||' of '||eligible||' retained work items have complete history/identity coverage. '
   ||case when result_value is null then 'Value withheld because coverage is incomplete.' else 'Confirmed review is still required.' end,proof,'serviceos.work.team-residence@1','work.team_owned_item_minutes');
 payload:=jsonb_build_object('id',p_request,'tenantId',p_tenant,'subject',jsonb_build_object('kind','team','id',p_team),
   'metricKey','work.team_owned_item_minutes','policyId',p_policy,'policyVersion',p_revision,
   'period',jsonb_build_object('start',p_start,'end',p_end),'value',result_value,'unit','item_minutes',
   'sampleCount',covered,'coveredCount',covered,'eligibleCount',eligible,'observedAt',observed,
   'sourceThrough',case when covered=eligible then source_through end,'sourceSystem','serviceos.work.team-residence@1',
   'review','inferred','evidence',jsonb_build_array(jsonb_build_object('table','learn_team_work_measurement_runs','id',p_request)),
   'exclusions','[]'::jsonb);
 ack:=learn_performance_append(p_tenant,payload,btrim(p_reason));
 return ack;
end $$;
revoke all on function public.learn_team_work_residence_collect(uuid,uuid,uuid,int,timestamptz,timestamptz,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_team_work_residence_collect(uuid,uuid,uuid,int,timestamptz,timestamptz,uuid,text) to authenticated;

-- SOURCE supabase/migrations/20261101090000_learn_resumable_work_collection.sql
-- Resumable work collection. Sources and previous receipts are never rewritten.
-- This remains a candidate until paired client verification and a pinned TEST release.
create table public.learn_work_collection_runs (
 id uuid primary key, tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id), request jsonb not null,
 kind text not null check(kind in ('handoffs','residence','teamResidence')),
 subject_kind text not null check(subject_kind in ('member','team')), subject_id uuid not null,
 policy_id uuid not null, policy_revision integer not null, policy jsonb not null,
 window_start timestamptz not null, window_end timestamptz not null, reason text not null,
 snapshot_at timestamptz not null, roster jsonb not null, teams jsonb not null,
 source_system text not null, metric_key text not null, unit text not null,
 state text not null default 'collecting' check(state in ('collecting','completed','abandoned','superseded')),
 population integer not null default 0, processed integer not null default 0,
 eligible integer not null default 0, covered integer not null default 0, known_value numeric not null default 0,
 observed_at timestamptz, explanation text, proof jsonb, end_reason text,
 check(processed between 0 and population and covered between 0 and eligible and eligible<=processed),
 check(octet_length(roster::text)<=2097152 and octet_length(teams::text)<=2097152),
 check((state='completed')=(proof is not null))
);
create unique index learn_work_collection_active_cell on public.learn_work_collection_runs
 (tenant_id,kind,subject_id,policy_id,policy_revision,window_start,window_end) where state='collecting';
create table public.learn_work_collection_items (
 run_id uuid not null references public.learn_work_collection_runs(id),
 tenant_id uuid not null references public.tenants(id), ordinal bigint not null, object_id uuid not null,
 head_sequence bigint, head_reconciled boolean not null, first_kind text, first_at timestamptz,
 result jsonb check(result is null or octet_length(result::text)<=1048576),
 primary key(run_id,ordinal), unique(run_id,object_id)
);
create index learn_work_collection_items_tenant on public.learn_work_collection_items(tenant_id,run_id,ordinal);
alter table public.learn_work_collection_runs enable row level security;
alter table public.learn_work_collection_items enable row level security;
revoke all on public.learn_work_collection_runs,public.learn_work_collection_items from public,anon,authenticated,service_role;
grant select on public.learn_work_collection_runs,public.learn_work_collection_items to authenticated;
create policy learn_work_collection_runs_read on public.learn_work_collection_runs for select to authenticated
 using(tenant_id=current_tenant_id() and coalesce(current_user_role(),'') in ('owner','admin'));
create policy learn_work_collection_items_read on public.learn_work_collection_items for select to authenticated
 using(tenant_id=current_tenant_id() and coalesce(current_user_role(),'') in ('owner','admin'));
create function public.learn_work_collection_immutable() returns trigger
language plpgsql set search_path=public,pg_temp as $$begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'Retained collection evidence cannot be removed' using errcode='55000';end if;
 if tg_table_name='learn_work_collection_items' then
  if old.result is not null or new.result is null or (to_jsonb(new)-'result') is distinct from (to_jsonb(old)-'result') then
   raise exception 'Frozen item evidence cannot change' using errcode='55000';end if;
 else
  if old.state<>'collecting' or
    (to_jsonb(new)-array['population','processed','eligible','covered','known_value','state','observed_at','explanation','proof','end_reason'])
    is distinct from (to_jsonb(old)-array['population','processed','eligible','covered','known_value','state','observed_at','explanation','proof','end_reason'])
    or new.processed<old.processed or new.eligible<old.eligible or new.covered<old.covered or new.known_value<old.known_value
    or (old.population<>0 and new.population<>old.population) then
    raise exception 'Frozen collection scope or completed evidence cannot change' using errcode='55000';end if;
 end if;return new;
end $$;
create trigger learn_work_collection_runs_immutable before update or delete on public.learn_work_collection_runs
 for each row execute function public.learn_work_collection_immutable();
create trigger learn_work_collection_runs_no_truncate before truncate on public.learn_work_collection_runs
 for each statement execute function public.learn_work_collection_immutable();
create trigger learn_work_collection_items_immutable before update or delete on public.learn_work_collection_items
 for each row execute function public.learn_work_collection_immutable();
create trigger learn_work_collection_items_no_truncate before truncate on public.learn_work_collection_items
 for each statement execute function public.learn_work_collection_immutable();
revoke all on function public.learn_work_collection_immutable() from public,anon,authenticated,service_role;

-- Every mutation rechecks actual tenant, role, actor and View-As. The shared profile
-- lock serializes revocation with a batch; no browser-reported authority is trusted.
create function public.learn_work_collection_access(p_tenant uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$declare actor uuid:=auth.uid();begin
 if actor is null or p_tenant is distinct from current_tenant_id() then raise exception 'Owner/admin access required' using errcode='42501';end if;
 perform 1 from profiles where id=actor and tenant_id=p_tenant and role in ('owner','admin') for share;
 if not found then raise exception 'Owner/admin access required' using errcode='42501';end if;
 if exists(select 1 from view_as_context where actor_user_id=actor and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'View-As cannot collect observations' using errcode='42501';end if;
 return actor;
end $$;
revoke all on function public.learn_work_collection_access(uuid) from public,anon,authenticated,service_role;

-- Read only history visible at the frozen per-object head. Later writes, baseline
-- creation and newly inserted objects cannot leak into a resumed calculation.
create function public.learn_work_collection_history(p_item public.learn_work_collection_items,p_start timestamptz,p_end timestamptz,p_observed timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare predecessor bigint;n integer;events jsonb;begin
 if not p_item.head_reconciled then raise exception 'Frozen work state did not reconcile with capture' using errcode='55000';end if;
 if p_item.head_sequence is not null and not exists(select 1 from object_state_history where tenant_id=p_item.tenant_id and object_id=p_item.object_id and capture_sequence=p_item.head_sequence) then
  raise exception 'Frozen work history unavailable' using errcode='55000';end if;
 if exists(select 1 from (select occurred_at,work_before,lag(occurred_at) over(order by capture_sequence) prior_at,
   lag(work_after) over(order by capture_sequence) prior_state from object_state_history
   where tenant_id=p_item.tenant_id and object_id=p_item.object_id and capture_kind is not null and capture_sequence<=p_item.head_sequence) h
   where occurred_at<prior_at or (prior_state is not null and work_before is distinct from prior_state)) then
  raise exception 'Frozen work capture contains an unexplained gap' using errcode='55000';end if;
 select capture_sequence into predecessor from object_state_history where tenant_id=p_item.tenant_id and object_id=p_item.object_id
   and capture_kind is not null and capture_sequence<=p_item.head_sequence and occurred_at<p_start order by capture_sequence desc limit 1;
 select count(*) into n from object_state_history where tenant_id=p_item.tenant_id and object_id=p_item.object_id and capture_kind is not null
   and capture_sequence<=p_item.head_sequence and (capture_sequence=predecessor or occurred_at between p_start and p_end);
 if n>1000 then raise exception 'Individual work history exceeds review limit' using errcode='54000';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'sequence',capture_sequence::text,'kind',capture_kind,'occurredAt',occurred_at,
   'before',work_before,'after',work_after) order by capture_sequence),'[]') into events from object_state_history
   where tenant_id=p_item.tenant_id and object_id=p_item.object_id and capture_kind is not null and capture_sequence<=p_item.head_sequence
    and (capture_sequence=predecessor or occurred_at between p_start and p_end);
 return jsonb_build_object('objectId',p_item.object_id,'coverageStart',p_item.first_at,'sourceThrough',case when p_item.head_sequence is not null then p_observed end,'count',n,'events',events);
end $$;
revoke all on function public.learn_work_collection_history(public.learn_work_collection_items,timestamptz,timestamptz,timestamptz) from public,anon,authenticated,service_role;
create or replace function public.learn_work_frozen_owner(p_roster jsonb,p_teams jsonb,p_ref jsonb,p_at timestamptz)
returns text language plpgsql immutable set search_path=public,pg_temp as $$
declare m jsonb; e jsonb; state jsonb; found_owner text; n int:=0; ref_id uuid;
begin
 if p_ref is null or p_ref='null'::jsonb or coalesce(p_ref->>'kind','') not in ('member','user','team','org_unit') then return null; end if;
 begin ref_id:=(p_ref->>'ref')::uuid; exception when invalid_text_representation then return null; end;
 if ref_id is null then return null; end if;
 if p_ref->>'kind' in ('team','org_unit') then
   if exists(select 1 from jsonb_array_elements(p_teams) t where t->>'id'=ref_id::text and (t->>'createdAt')::timestamptz<=p_at) then return 'team:'||ref_id::text; end if;
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
revoke all on function public.learn_work_frozen_owner(jsonb,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;


create function public.learn_work_collection_calculate(p_kind text,p_subject uuid,p_history jsonb,p_roster jsonb,p_teams jsonb,p_start timestamptz,p_end timestamptz,p_first_kind text)
returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare history jsonb:=p_history;roster jsonb:=p_roster;object_id uuid:=(p_history->>'objectId')::uuid;
 object_complete boolean;ev jsonb;next_ev jsonb;owner text;before_owner text;after_owner text;at timestamptz;
 owner_team uuid;membership_event jsonb;member_capture jsonb;
 interval_start timestamptz;interval_end timestamptz;segment_start timestamptz;segment_end timestamptz;
 boundaries timestamptz[];points timestamptz[];i integer;j integer;segment_count integer:=0;
 item_minutes numeric:=0;transfers integer:=0;credited jsonb:='[]';
begin
 if p_kind not in ('handoffs','residence','teamResidence') then raise exception 'Unsupported collection kind' using errcode='22023';end if;
 if p_first_kind='insert' and (history->>'coverageStart')::timestamptz>=p_end then
  return jsonb_build_object('objectId',object_id,'eligible',false,'complete',true,'knownValue',0,'eventIds','[]'::jsonb,'credited','[]'::jsonb);end if;
 object_complete:=history->>'coverageStart' is not null and ((history->>'coverageStart')::timestamptz<=p_start or p_first_kind='insert');
 select coalesce(array_agg(distinct boundary order by boundary),'{}'::timestamptz[]) into boundaries from (
   select (m->>'coverageStart')::timestamptz boundary from jsonb_array_elements(roster->'members') m
   union all select (e->>'observedAt')::timestamptz from jsonb_array_elements(roster->'members') m cross join lateral jsonb_array_elements(m->'events') e
   union all select (e#>>'{after,effectiveFrom}')::timestamptz from jsonb_array_elements(roster->'members') m cross join lateral jsonb_array_elements(m->'events') e
   union all select (e#>>'{after,effectiveTo}')::timestamptz from jsonb_array_elements(roster->'members') m cross join lateral jsonb_array_elements(m->'events') e
   union all select (e#>>'{after,confirmedAt}')::timestamptz from jsonb_array_elements(roster->'members') m cross join lateral jsonb_array_elements(m->'events') e
 ) b where boundary>p_start and boundary<p_end;
 if p_kind='handoffs' then
   for ev in select value from jsonb_array_elements(history->'events') loop
     at:=(ev->>'occurredAt')::timestamptz;
     if ev->>'kind'<>'update' or at<p_start or at>=p_end
       or ev#>'{before,responsible_ref}'='null'::jsonb or ev#>'{after,responsible_ref}'='null'::jsonb
       or ev#>'{before,responsible_ref}'=ev#>'{after,responsible_ref}' then continue; end if;
     before_owner:=learn_work_frozen_owner(roster,p_teams,ev#>'{before,responsible_ref}',at);
     if before_owner is null then object_complete:=false; continue; end if;
     if before_owner<>'member:'||p_subject::text then continue; end if;
     after_owner:=learn_work_frozen_owner(roster,p_teams,ev#>'{after,responsible_ref}',at);
     if after_owner is null then object_complete:=false; continue; end if;
     if before_owner=after_owner then continue; end if; -- user/member aliases are not a transfer.
     transfers:=transfers+1;
     credited:=credited||jsonb_build_array(jsonb_build_object('objectId',object_id,'eventId',ev->>'id',
       'occurredAt',at,'from',before_owner,'to',after_owner));
   end loop;
 elsif p_kind='residence' then
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
       owner:=learn_work_frozen_owner(roster,p_teams,ev#>'{after,responsible_ref}',segment_start);
       if owner is null then object_complete:=false; continue; end if;
       if owner<>'member:'||p_subject::text then continue; end if;
       item_minutes:=item_minutes+extract(epoch from segment_end-segment_start)/60;
       credited:=credited||jsonb_build_array(jsonb_build_object('objectId',object_id,
         'start',segment_start,'end',segment_end,'itemMinutes',extract(epoch from segment_end-segment_start)/60,
         'owner',owner,'responsible',ev#>'{after,responsible_ref}','status',ev#>'{after,status}',
         'waitingOn',ev#>'{after,waiting_on_ref}',
         'workEventIds',case when next_ev is null then jsonb_build_array(ev->>'id') else jsonb_build_array(ev->>'id',next_ev->>'id') end));
     end loop;
   end loop;
 else
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
       owner:=learn_work_frozen_owner(roster,p_teams,ev#>'{after,responsible_ref}',segment_start);
       if owner is null then object_complete:=false; continue; end if;
       -- Count an item segment once: direct team assignment OR its observed member's team.
       -- Current member rows and member score percentages never determine attribution.
       membership_event:=null; owner_team:=null;
       if owner like 'team:%' then owner_team:=substring(owner from 6)::uuid;
       else
         select m into member_capture from jsonb_array_elements(roster->'members') m
           where m->>'memberId'=substring(owner from 8);
         select e into membership_event from jsonb_array_elements(member_capture->'events') e
           where (e->>'observedAt')::timestamptz<=segment_start
           order by (e->>'sequence')::bigint desc limit 1;
         if membership_event is null or not (membership_event->'after' ? 'teamId') then
           object_complete:=false; continue;
         end if;
         owner_team:=(membership_event#>>'{after,teamId}')::uuid;
         -- An explicitly ungrouped member has known non-team ownership.
         if owner_team is null then continue; end if;

       end if;
       if not exists(select 1 from jsonb_array_elements(p_teams) t where t->>'id'=owner_team::text and (t->>'createdAt')::timestamptz<=segment_start) then
         object_complete:=false; continue;
       end if;
       if owner_team<>p_subject then continue; end if;
       item_minutes:=item_minutes+extract(epoch from segment_end-segment_start)/60;
       credited:=credited||jsonb_build_array(jsonb_build_object('objectId',object_id,
         'start',segment_start,'end',segment_end,'itemMinutes',extract(epoch from segment_end-segment_start)/60,
         'owner',owner,'teamId',p_subject,'membershipEventId',membership_event->'id','responsible',ev#>'{after,responsible_ref}','status',ev#>'{after,status}',
         'waitingOn',ev#>'{after,waiting_on_ref}',
         'workEventIds',case when next_ev is null then jsonb_build_array(ev->>'id') else jsonb_build_array(ev->>'id',next_ev->>'id') end));
     end loop;
   end loop;

 end if;
 return jsonb_build_object('objectId',object_id,'eligible',true,'complete',object_complete,
  'coverageStart',history->'coverageStart','sourceThrough',history->'sourceThrough',
  'knownValue',case when p_kind='handoffs' then transfers else item_minutes end,
  'eventIds',(select coalesce(jsonb_agg(v->'id'),'[]') from jsonb_array_elements(history->'events') v),'credited',credited);
end $$;
revoke all on function public.learn_work_collection_calculate(text,uuid,jsonb,jsonb,jsonb,timestamptz,timestamptz,text) from public,anon,authenticated,service_role;

create function public.learn_work_collection_result(p_run public.learn_work_collection_runs) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
 select jsonb_build_object('contract','work-collection@1','requestId',p_run.id,'tenantId',p_run.tenant_id,'actorId',p_run.actor_id,'state',p_run.state,
 'kind',p_run.kind,'subjectId',p_run.subject_id,'policyId',p_run.policy_id,'policyVersion',p_run.policy_revision,
 'period',jsonb_build_object('start',p_run.window_start,'end',p_run.window_end),
 'population',p_run.population,'processed',p_run.processed,'eligible',p_run.eligible,'covered',p_run.covered,
 'snapshotAt',p_run.snapshot_at,'measurementId',case when p_run.state='completed' then p_run.id end,
 'endReason',p_run.end_reason);
$$;
revoke all on function public.learn_work_collection_result(public.learn_work_collection_runs) from public,anon,authenticated,service_role;
create function public.learn_work_collection_cell_lock(p_tenant uuid,p_kind text,p_subject uuid,p_policy uuid,p_revision integer,p_start timestamptz,p_end timestamptz) returns void
language sql volatile set search_path=public,pg_temp as $$
 select pg_advisory_xact_lock(hashtextextended((case p_kind when 'handoffs' then 'learn-handoff-cell:' when 'residence' then 'learn-residence-cell:' else 'learn-team-residence-cell:' end)
  ||p_tenant::text||p_subject::text||p_policy::text||p_revision::text||extract(epoch from p_start)::text||':'||extract(epoch from p_end)::text,0));
$$;
revoke all on function public.learn_work_collection_cell_lock(uuid,text,uuid,uuid,integer,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create function public.learn_work_collection_begin(p_tenant uuid,p_kind text,p_subject uuid,p_policy uuid,p_revision integer,
 p_start timestamptz,p_end timestamptz,p_request uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);descriptor jsonb;r learn_work_collection_runs%rowtype;
 pol jsonb;rule jsonb;sk text;mk text;src text;un text;n integer;
begin
 if p_kind is null or p_kind not in ('handoffs','residence','teamResidence') or p_subject is null or p_policy is null or p_request is null
  or p_revision is null or p_revision<1 or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_start>=p_end or p_end>statement_timestamp() or p_end-p_start>interval '366 days' or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
  raise exception 'Choose a supported collection, completed period and reason' using errcode='22023';end if;
 descriptor:=jsonb_build_object('contract','work-collection@1','kind',p_kind,'subjectId',p_subject,'policyId',p_policy,'policyVersion',p_revision,
  'start',p_start,'end',p_end,'reason',btrim(p_reason),'actorId',actor);
 perform pg_advisory_xact_lock(hashtextextended('learn-work-collect:'||p_request::text,0));
 select * into r from learn_work_collection_runs where id=p_request;
 if found then
  if r.tenant_id<>p_tenant or r.request is distinct from descriptor then raise exception 'Collection request identity changed' using errcode='PT409';end if;
  return learn_work_collection_result(r);
 end if;
 if exists(select 1 from measurements where id=p_request) or exists(select 1 from learn_work_measurement_runs where id=p_request)
  or exists(select 1 from learn_team_work_measurement_runs where id=p_request) then raise exception 'Request identity already used' using errcode='PT409';end if;
 sk:=case when p_kind='teamResidence' then 'team' else 'member' end;
 mk:=case p_kind when 'handoffs' then 'work.recorded_handoffs' when 'residence' then 'work.owned_item_minutes' else 'work.team_owned_item_minutes' end;
 src:=case p_kind when 'handoffs' then 'serviceos.work.handoffs@1' when 'residence' then 'serviceos.work.residence@1' else 'serviceos.work.team-residence@1' end;
 un:=case p_kind when 'handoffs' then 'handoffs' else 'item_minutes' end;
 if sk='team' then perform 1 from org_units where id=p_subject and tenant_id=p_tenant for share;
 else perform 1 from team_members where id=p_subject and tenant_id=p_tenant for share;end if;
 if not found then raise exception 'Subject not in tenant' using errcode='22023';end if;
 select e.value into pol from operating_profile_entries e join config_versions c on c.id=e.version_id and c.tenant_id=e.tenant_id
  where e.tenant_id=p_tenant and e.namespace='learn_scorecards' and e.scope_kind='tenant' and e.key like 'definition.%'
  and e.value->>'id'=p_policy::text and e.value->>'version'=p_revision::text and c.artifact_kind='learn_scorecard'
  and c.version=p_revision and c.status in ('draft','published') for share of e,c;
 if pol is null or pol->>'subjectKind' is distinct from sk or
  (pol->>'groupId' is not null and (sk<>'team' or pol->>'groupId' is distinct from p_subject::text)) then
  raise exception 'Policy does not cover this subject' using errcode='22023';end if;
 select value into rule from jsonb_array_elements(pol->'metrics') where value->>'key'=mk;
 if rule is null or rule->>'unit' is distinct from un or not coalesce((rule->'sourceSystems') ? src,false) then
  raise exception 'Policy does not define this collection' using errcode='22023';end if;
 perform learn_work_collection_cell_lock(p_tenant,p_kind,p_subject,p_policy,p_revision,p_start,p_end);
 if exists(select 1 from measurements where tenant_id=p_tenant and subject_kind=sk and subject_id=p_subject and policy_id=p_policy
   and policy_revision=p_revision and metric_key=mk and window_start=p_start and window_end=p_end)
  or exists(select 1 from learn_work_collection_runs where tenant_id=p_tenant and kind=p_kind and subject_id=p_subject
   and policy_id=p_policy and policy_revision=p_revision and window_start=p_start and window_end=p_end and state='collecting') then
  raise exception 'An observation or collection already exists for this cell' using errcode='PT409';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.intelligence_objects'::regclass and tgname='learn_capture_work_change' and tgenabled in ('O','A')) then
  raise exception 'Work capture is unavailable' using errcode='55000';end if;
 -- One statement snapshot freezes membership, team directory, population and each
 -- work history head. UUID ordering is materialized, never re-queried on resume.
 with frozen as materialized (select learn_member_history_read(p_tenant,p_start,p_end) roster,
  (select coalesce(jsonb_agg(jsonb_build_object('id',id,'createdAt',created_at) order by id),'[]') from org_units where tenant_id=p_tenant) teams),
 inserted as (insert into learn_work_collection_runs(id,tenant_id,actor_id,request,kind,subject_kind,subject_id,policy_id,policy_revision,policy,
  window_start,window_end,reason,snapshot_at,roster,teams,source_system,metric_key,unit)
  select p_request,p_tenant,actor,descriptor,p_kind,sk,p_subject,p_policy,p_revision,pol,p_start,p_end,btrim(p_reason),statement_timestamp(),roster,teams,src,mk,un from frozen returning id)
 insert into learn_work_collection_items(run_id,tenant_id,ordinal,object_id,head_sequence,head_reconciled,first_kind,first_at)
 select inserted.id,p_tenant,row_number() over(order by o.id),o.id,h.capture_sequence,
  (h.id is null or (h.work_after=learn_work_snapshot(o) and h.occurred_at<=statement_timestamp())),f.capture_kind,f.occurred_at
 from inserted cross join intelligence_objects o
 left join lateral (select id,capture_sequence,work_after,occurred_at from object_state_history where tenant_id=p_tenant and object_id=o.id and capture_kind is not null order by capture_sequence desc limit 1) h on true
 left join lateral (select capture_kind,occurred_at from object_state_history where tenant_id=p_tenant and object_id=o.id and capture_kind is not null order by capture_sequence limit 1) f on true
 where o.tenant_id=p_tenant;
 get diagnostics n=row_count;
 if exists(select 1 from learn_work_collection_items where run_id=p_request and not head_reconciled) then
  raise exception 'Current work state does not reconcile with captured history' using errcode='55000';end if;
 update learn_work_collection_runs set population=n where id=p_request returning * into r;
 perform learn_work_collection_access(p_tenant);
 return learn_work_collection_result(r);
end $$;
revoke all on function public.learn_work_collection_begin(uuid,text,uuid,uuid,integer,timestamptz,timestamptz,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_collection_begin(uuid,text,uuid,uuid,integer,timestamptz,timestamptz,uuid,text) to authenticated;

-- Existence of an unfinished run cannot serve as evidence for a score observation.
do $patch$ declare d text;old_list text;new_list text;anchor text;begin
 select pg_get_functiondef('public.learn_performance_append(uuid,jsonb,text)'::regprocedure) into d;
 old_list:=$old$('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members','learn_work_measurement_runs','learn_team_work_measurement_runs')$old$;
 new_list:=$new$('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members','learn_work_measurement_runs','learn_team_work_measurement_runs','learn_work_collection_runs')$new$;
 anchor:=$anchor$if not exists_ref then raise exception 'Missing or foreign evidence' using errcode='22023'; end if;$anchor$;
 if array_length(string_to_array(d,old_list),1) is distinct from 2 or array_length(string_to_array(d,anchor),1) is distinct from 2 then
  raise exception 'Unexpected performance evidence contract';end if;
 d:=replace(d,old_list,new_list);
 d:=replace(d,anchor,anchor||$guard$
  if ref->>'table'='learn_work_collection_runs' and not exists(select 1 from public.learn_work_collection_runs where tenant_id=p_tenant_id and id=(ref->>'id')::uuid and state='completed') then
   raise exception 'Incomplete collection cannot support an observation' using errcode='22023';end if;
$guard$);
 execute d;
end $patch$;

create function public.learn_work_collection_step(p_tenant uuid,p_request uuid,p_after integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);r learn_work_collection_runs%rowtype;i learn_work_collection_items%rowtype;
 item_result jsonb;pol jsonb;value numeric;payload jsonb;ack jsonb;begin
 select * into r from learn_work_collection_runs where id=p_request and tenant_id=p_tenant for update;
 if not found or r.actor_id<>actor then raise exception 'Collection unavailable to this actor' using errcode='42501';end if;
 if p_after is null or p_after<0 or p_after>r.processed then raise exception 'Collection checkpoint changed' using errcode='PT409';end if;
 if r.state<>'collecting' or p_after<r.processed then return learn_work_collection_result(r);end if;
 for i in select * from learn_work_collection_items where run_id=p_request and ordinal>r.processed order by ordinal limit 100 loop
  if i.result is not null then raise exception 'Unexpected item checkpoint' using errcode='55000';end if;
  item_result:=learn_work_collection_calculate(r.kind,r.subject_id,learn_work_collection_history(i,r.window_start,r.window_end,r.snapshot_at),r.roster,r.teams,r.window_start,r.window_end,i.first_kind);
  update learn_work_collection_items set result=item_result where run_id=i.run_id and ordinal=i.ordinal;
  r.processed:=r.processed+1;
  if (item_result->>'eligible')::boolean then
   r.eligible:=r.eligible+1;
   if (item_result->>'complete')::boolean then r.covered:=r.covered+1;end if;
   r.known_value:=r.known_value+(item_result->>'knownValue')::numeric;
  end if;
 end loop;
 if r.processed=r.population then
  perform learn_work_collection_cell_lock(r.tenant_id,r.kind,r.subject_id,r.policy_id,r.policy_revision,r.window_start,r.window_end);
  if exists(select 1 from measurements where tenant_id=p_tenant and subject_kind=r.subject_kind and subject_id=r.subject_id
    and policy_id=r.policy_id and policy_revision=r.policy_revision and metric_key=r.metric_key and window_start=r.window_start and window_end=r.window_end) then
   r.state:='superseded';r.end_reason:='Another observation already exists for this cell. Review it before collecting again.';
  else
   select e.value into pol from operating_profile_entries e join config_versions c on c.id=e.version_id and c.tenant_id=e.tenant_id
    where e.tenant_id=p_tenant and e.namespace='learn_scorecards' and e.scope_kind='tenant' and e.key like 'definition.%'
    and e.value->>'id'=r.policy_id::text and e.value->>'version'=r.policy_revision::text and c.artifact_kind='learn_scorecard'
    and c.version=r.policy_revision and c.status in ('draft','published') for share of e,c;
   if pol is distinct from r.policy then
    r.state:='superseded';r.end_reason:='Scoring rules changed during collection. Start a new collection for the saved rules.';
   else
    r.state:='completed';r.observed_at:=clock_timestamp();value:=case when r.covered=r.eligible then r.known_value end;
    r.explanation:='Frozen retained-work collection processed in batches. '||r.covered||' of '||r.eligible||' eligible items have complete history and identity coverage. '
     ||case when r.kind='handoffs' then 'Counts captured outgoing transfers; member/user aliases are not extra transfers. ' else 'Counts elapsed owned item-minutes including waiting and closed states; simultaneous items add separately. ' end
     ||'This is not working hours, speed or productivity. No business calendar or delay exclusion applied. '
     ||case when value is null then 'Value withheld because coverage is incomplete.' else 'Human review remains required.' end;
    r.proof:=jsonb_build_object('contract','work-collection@1','kind',r.kind,'runId',r.id,'snapshotAt',r.snapshot_at,'population','all retained intelligence objects at snapshot',
     'populationCount',r.population,'processed',r.processed,'eligibleItems',r.eligible,'coveredItems',r.covered,'knownValue',r.known_value,'value',value,
     'itemsTable','learn_work_collection_items','itemCount',r.population,'membershipStored',true,'teamDirectoryStored',true);
   end if;
  end if;
 end if;
 perform learn_work_collection_access(p_tenant);
 update learn_work_collection_runs set processed=r.processed,eligible=r.eligible,covered=r.covered,known_value=r.known_value,
  state=r.state,observed_at=r.observed_at,explanation=r.explanation,proof=r.proof,end_reason=r.end_reason where id=p_request;
 if r.state='completed' then
  payload:=jsonb_build_object('id',r.id,'tenantId',p_tenant,'subject',jsonb_build_object('kind',r.subject_kind,'id',r.subject_id),
   'metricKey',r.metric_key,'policyId',r.policy_id,'policyVersion',r.policy_revision,'period',jsonb_build_object('start',r.window_start,'end',r.window_end),
   'value',value,'unit',r.unit,'sampleCount',r.covered,'coveredCount',r.covered,'eligibleCount',r.eligible,'observedAt',r.observed_at,
   'sourceThrough',case when r.covered=r.eligible then r.snapshot_at end,'sourceSystem',r.source_system,'review','inferred',
   'evidence',jsonb_build_array(jsonb_build_object('table','learn_work_collection_runs','id',r.id)),'exclusions','[]'::jsonb);
  ack:=learn_performance_append(p_tenant,payload,r.reason);
 end if;
 return learn_work_collection_result(r);
end $$;
revoke all on function public.learn_work_collection_step(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_collection_step(uuid,uuid,integer) to authenticated;

-- Ending an unconfirmed start shares the request lock with begin and retains a
-- terminal intent even when no source snapshot was created. A delayed begin can
-- only read that terminal result; it cannot resurrect the request.
create function public.learn_work_collection_abandon(p_tenant uuid,p_kind text,p_subject uuid,p_policy uuid,p_revision integer,
 p_start timestamptz,p_end timestamptz,p_request uuid,p_reason text,p_end_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);r learn_work_collection_runs%rowtype;descriptor jsonb;begin
 if p_kind is null or p_kind not in ('handoffs','residence','teamResidence') or p_subject is null or p_policy is null or p_request is null
  or p_revision is null or p_revision<1 or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_start>=p_end or p_end>statement_timestamp() or p_end-p_start>interval '366 days'
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or length(btrim(coalesce(p_end_reason,''))) not between 1 and 1000 then
  raise exception 'An exact collection request and ending reason are required' using errcode='22023';end if;
 descriptor:=jsonb_build_object('contract','work-collection@1','kind',p_kind,'subjectId',p_subject,'policyId',p_policy,'policyVersion',p_revision,
  'start',p_start,'end',p_end,'reason',btrim(p_reason),'actorId',actor);
 perform pg_advisory_xact_lock(hashtextextended('learn-work-collect:'||p_request::text,0));
 select * into r from learn_work_collection_runs where id=p_request for update;
 if found then
  if r.tenant_id<>p_tenant or r.actor_id<>actor or r.request is distinct from descriptor then raise exception 'Collection request identity changed' using errcode='PT409';end if;
  if r.state='collecting' then
   update learn_work_collection_runs set state='abandoned',end_reason=btrim(p_end_reason) where id=p_request returning * into r;
  elsif r.state='abandoned' and r.end_reason is distinct from btrim(p_end_reason) then
   raise exception 'Collection ending reason already recorded' using errcode='PT409';end if;
 else
  if exists(select 1 from measurements where id=p_request) or exists(select 1 from learn_work_measurement_runs where id=p_request)
   or exists(select 1 from learn_team_work_measurement_runs where id=p_request) then raise exception 'Request identity already used' using errcode='PT409';end if;
  insert into learn_work_collection_runs(id,tenant_id,actor_id,request,kind,subject_kind,subject_id,policy_id,policy_revision,policy,
   window_start,window_end,reason,snapshot_at,roster,teams,source_system,metric_key,unit,state,end_reason)
  values(p_request,p_tenant,actor,descriptor,p_kind,case when p_kind='teamResidence' then 'team' else 'member' end,p_subject,p_policy,p_revision,'{}',
   p_start,p_end,btrim(p_reason),statement_timestamp(),'{}','[]',
   case p_kind when 'handoffs' then 'serviceos.work.handoffs@1' when 'residence' then 'serviceos.work.residence@1' else 'serviceos.work.team-residence@1' end,
   case p_kind when 'handoffs' then 'work.recorded_handoffs' when 'residence' then 'work.owned_item_minutes' else 'work.team_owned_item_minutes' end,
   case p_kind when 'handoffs' then 'handoffs' else 'item_minutes' end,'abandoned',btrim(p_end_reason)) returning * into r;
 end if;
 perform learn_work_collection_access(p_tenant);
 return learn_work_collection_result(r);
end $$;
revoke all on function public.learn_work_collection_abandon(uuid,text,uuid,uuid,integer,timestamptz,timestamptz,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_collection_abandon(uuid,text,uuid,uuid,integer,timestamptz,timestamptz,uuid,text,text) to authenticated;

create function public.learn_work_collection_status(p_tenant uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);r learn_work_collection_runs%rowtype;begin
 select * into r from learn_work_collection_runs where tenant_id=p_tenant and id=p_request;
 if not found or r.actor_id<>actor then raise exception 'Collection unavailable to this actor' using errcode='42501';end if;
 return learn_work_collection_result(r);
end $$;
revoke all on function public.learn_work_collection_status(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_collection_status(uuid,uuid) to authenticated;

-- Complete proof is retained by item and read in deterministic, bounded pages.
-- The overview identifies all rows and stores the frozen identity context separately.
create function public.learn_work_collection_evidence(p_tenant uuid,p_request uuid,p_part text,p_after bigint default 0) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);r learn_work_collection_runs%rowtype;i learn_work_collection_items%rowtype;
 rows jsonb:='[]';entry jsonb;bytes integer:=0;last_ordinal bigint:=p_after;begin
 select * into r from learn_work_collection_runs where tenant_id=p_tenant and id=p_request;
 if not found or r.state<>'completed' then raise exception 'Completed collection evidence unavailable' using errcode='42501';end if;
 if p_part is null or p_part not in ('overview','membership','teams','items') or p_after is null or p_after<0 or p_after>r.population or (p_part<>'items' and p_after<>0) then
  raise exception 'Invalid evidence page' using errcode='22023';end if;
 if p_part='overview' then return jsonb_build_object('contract','work-collection-evidence@1','runId',r.id,'tenantId',r.tenant_id,'part',p_part,
  'sourceSystem',r.source_system,'metricKey',r.metric_key,'observedAt',r.observed_at,'explanation',r.explanation,'proof',r.proof,
  'policy',r.policy,'subject',jsonb_build_object('kind',r.subject_kind,'id',r.subject_id),'period',jsonb_build_object('start',r.window_start,'end',r.window_end));end if;
 if p_part in ('membership','teams') then return jsonb_build_object('contract','work-collection-evidence@1','runId',r.id,'tenantId',r.tenant_id,'part',p_part,
  'snapshotAt',r.snapshot_at,'data',case p_part when 'membership' then r.roster else r.teams end);end if;
 for i in select * from learn_work_collection_items where run_id=p_request and ordinal>p_after order by ordinal limit 100 loop
  if i.result is null or i.ordinal<>last_ordinal+1 then raise exception 'Retained proof is incomplete' using errcode='55000';end if;
  entry:=(to_jsonb(i)-array['run_id','tenant_id'])||jsonb_build_object('head_sequence',i.head_sequence::text);
  if bytes+octet_length(entry::text)>2097152 and last_ordinal>p_after then exit;end if;
  bytes:=bytes+octet_length(entry::text);rows:=rows||jsonb_build_array(entry);last_ordinal:=i.ordinal;
 end loop;
 if p_after<r.population and last_ordinal=p_after then raise exception 'Retained proof is incomplete' using errcode='55000';end if;
 return jsonb_build_object('contract','work-collection-evidence@1','runId',r.id,'tenantId',r.tenant_id,'part',p_part,
  'population',r.population,'after',p_after,'next',case when last_ordinal<r.population then last_ordinal end,'items',rows);
end $$;
revoke all on function public.learn_work_collection_evidence(uuid,uuid,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_collection_evidence(uuid,uuid,text,bigint) to authenticated;

-- SOURCE supabase/migrations/20261101100000_learn_work_calendars.sql
-- Candidate: versioned company calendars. No source capture or score changes.
-- Publication takes effect when recorded; it cannot supply rules for earlier time.
create table public.learn_work_calendar_versions (
 id uuid primary key, tenant_id uuid not null references public.tenants(id),
 revision integer not null check(revision>0), definition jsonb not null,
 actor_id uuid not null references public.profiles(id), reason text not null check(length(btrim(reason)) between 1 and 1000),
 request jsonb not null, recorded_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,revision),unique(tenant_id,id)
);
create table public.learn_work_calendar_publications (
 id uuid primary key,tenant_id uuid not null references public.tenants(id),
 version_id uuid not null,actor_id uuid not null references public.profiles(id),
 reason text not null check(length(btrim(reason)) between 1 and 1000), request jsonb not null,
 effective_from timestamptz not null,unique(tenant_id,effective_from),unique(tenant_id,version_id),
 foreign key(tenant_id,version_id) references public.learn_work_calendar_versions(tenant_id,id)
);
-- A cancellation is retained under the same request lock as save/publication.
-- It prevents an already in-flight request from appearing after UI recovery.
create table public.learn_work_calendar_cancellations (
 id uuid primary key,tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),kind text not null check(kind in ('save','publish')),
 request jsonb not null,recorded_at timestamptz not null default clock_timestamp()
);
alter table public.learn_work_calendar_cancellations enable row level security;
revoke all on public.learn_work_calendar_cancellations from public,anon,authenticated,service_role;
grant select on public.learn_work_calendar_cancellations to authenticated;
create policy learn_work_calendar_cancellations_read on public.learn_work_calendar_cancellations for select to authenticated
 using(tenant_id=public.current_tenant_id() and coalesce(public.current_user_role(),'') in ('owner','admin'));
alter table public.learn_work_calendar_versions enable row level security;
alter table public.learn_work_calendar_publications enable row level security;
revoke all on public.learn_work_calendar_versions,public.learn_work_calendar_publications from public,anon,authenticated,service_role;
grant select on public.learn_work_calendar_versions,public.learn_work_calendar_publications to authenticated;
create policy learn_work_calendar_versions_read on public.learn_work_calendar_versions for select to authenticated
 using(tenant_id=public.current_tenant_id() and coalesce(public.current_user_role(),'') in ('owner','admin'));
create policy learn_work_calendar_publications_read on public.learn_work_calendar_publications for select to authenticated
 using(tenant_id=public.current_tenant_id() and coalesce(public.current_user_role(),'') in ('owner','admin'));
create function public.learn_work_calendar_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$begin
 raise exception 'Recorded calendars are immutable' using errcode='55000';end $$;
revoke all on function public.learn_work_calendar_immutable() from public,anon,authenticated,service_role;
create trigger learn_work_calendar_versions_immutable before update or delete on public.learn_work_calendar_versions for each row execute function public.learn_work_calendar_immutable();
create trigger learn_work_calendar_versions_no_truncate before truncate on public.learn_work_calendar_versions for each statement execute function public.learn_work_calendar_immutable();
create trigger learn_work_calendar_publications_immutable before update or delete on public.learn_work_calendar_publications for each row execute function public.learn_work_calendar_immutable();
create trigger learn_work_calendar_publications_no_truncate before truncate on public.learn_work_calendar_publications for each statement execute function public.learn_work_calendar_immutable();

create trigger learn_work_calendar_cancellations_immutable before update or delete on public.learn_work_calendar_cancellations for each row execute function public.learn_work_calendar_immutable();
create trigger learn_work_calendar_cancellations_no_truncate before truncate on public.learn_work_calendar_cancellations for each statement execute function public.learn_work_calendar_immutable();

-- Local clock intervals use minute precision, [start,end), 0..1440. Overnight
-- shifts are explicitly split between dates. An empty override is a closed day.
create function public.learn_work_calendar_validate(p_definition jsonb) returns jsonb
language plpgsql stable set search_path=public,pg_temp as $$
declare v_window jsonb;v_exception jsonb;week jsonb;overrides jsonb;d date;begin
 if jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>262144 then
  raise exception 'Invalid company calendar' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(p_definition) k where k not in ('name','timezone','weekly','exceptions'))
  or jsonb_typeof(p_definition->'name') is distinct from 'string' or length(btrim(p_definition->>'name')) not between 1 and 200
  or jsonb_typeof(p_definition->'timezone') is distinct from 'string'
  or not exists(select 1 from pg_timezone_names where name=p_definition->>'timezone' and (name='UTC' or name like '%/%') and name not like 'posix/%' and name not like 'right/%')
  or jsonb_typeof(p_definition->'weekly') is distinct from 'array'
  or jsonb_typeof(p_definition->'exceptions') is distinct from 'array' then
  raise exception 'Calendar name, named timezone, weekly hours and date overrides required' using errcode='22023';end if;
 if jsonb_array_length(p_definition->'weekly')>84 or jsonb_array_length(p_definition->'exceptions')>366 then
  raise exception 'Calendar exceeds supported limits' using errcode='54000';end if;
 for v_window in select value from jsonb_array_elements(p_definition->'weekly') loop
  if jsonb_typeof(v_window) is distinct from 'object' then raise exception 'Invalid weekly window' using errcode='22023';end if;
  if exists(select 1 from jsonb_object_keys(v_window) k where k not in ('day','startMinute','endMinute'))
   or jsonb_typeof(v_window->'day') is distinct from 'number' or (v_window->>'day')::numeric not between 1 and 7 or mod((v_window->>'day')::numeric,1)<>0
   or jsonb_typeof(v_window->'startMinute') is distinct from 'number' or jsonb_typeof(v_window->'endMinute') is distinct from 'number'
   or (v_window->>'startMinute')::numeric not between 0 and 1439 or mod((v_window->>'startMinute')::numeric,1)<>0
   or (v_window->>'endMinute')::numeric not between 1 and 1440 or mod((v_window->>'endMinute')::numeric,1)<>0
   or (v_window->>'startMinute')::numeric::int>=(v_window->>'endMinute')::numeric::int then raise exception 'Invalid weekly window' using errcode='22023';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_definition->'weekly') with ordinality a(w,n)
  join jsonb_array_elements(p_definition->'weekly') with ordinality b(w,n) on a.n<b.n
  where (a.w->>'day')::numeric::int=(b.w->>'day')::numeric::int and (a.w->>'startMinute')::numeric::int<(b.w->>'endMinute')::numeric::int and (b.w->>'startMinute')::numeric::int<(a.w->>'endMinute')::numeric::int) then
  raise exception 'Weekly windows overlap' using errcode='22023';end if;
 for v_exception in select value from jsonb_array_elements(p_definition->'exceptions') loop
  if jsonb_typeof(v_exception) is distinct from 'object' then raise exception 'Invalid date override' using errcode='22023';end if;
  if exists(select 1 from jsonb_object_keys(v_exception) k where k not in ('date','windows')) or jsonb_typeof(v_exception->'date') is distinct from 'string'
   or (v_exception->>'date')!~'^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(v_exception->'windows') is distinct from 'array' then raise exception 'Invalid date override' using errcode='22023';end if;
  begin d:=(v_exception->>'date')::date;exception when others then raise exception 'Invalid override date' using errcode='22023';end;
  if d<date '2000-01-01' or d>date '2200-12-31' or to_char(d,'YYYY-MM-DD')<>v_exception->>'date' or jsonb_array_length(v_exception->'windows')>12 then
   raise exception 'Invalid override date or window limit' using errcode='22023';end if;
  for v_window in select value from jsonb_array_elements(v_exception->'windows') loop
   if jsonb_typeof(v_window) is distinct from 'object' then raise exception 'Invalid date window' using errcode='22023';end if;
   if exists(select 1 from jsonb_object_keys(v_window) k where k not in ('startMinute','endMinute'))
    or jsonb_typeof(v_window->'startMinute') is distinct from 'number' or jsonb_typeof(v_window->'endMinute') is distinct from 'number'
    or (v_window->>'startMinute')::numeric not between 0 and 1439 or mod((v_window->>'startMinute')::numeric,1)<>0
    or (v_window->>'endMinute')::numeric not between 1 and 1440 or mod((v_window->>'endMinute')::numeric,1)<>0
    or (v_window->>'startMinute')::numeric::int>=(v_window->>'endMinute')::numeric::int then raise exception 'Invalid date window' using errcode='22023';end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(v_exception->'windows') with ordinality a(w,n)
   join jsonb_array_elements(v_exception->'windows') with ordinality b(w,n) on a.n<b.n
   where (a.w->>'startMinute')::numeric::int<(b.w->>'endMinute')::numeric::int and (b.w->>'startMinute')::numeric::int<(a.w->>'endMinute')::numeric::int) then
   raise exception 'Date override windows overlap' using errcode='22023';end if;
 end loop;
 if (select count(*)<>count(distinct e->>'date') from jsonb_array_elements(p_definition->'exceptions') e) then
  raise exception 'Duplicate calendar override date' using errcode='22023';end if;
 select coalesce(jsonb_agg(w order by (w->>'day')::numeric::int,(w->>'startMinute')::numeric::int),'[]') into week from jsonb_array_elements(p_definition->'weekly') w;
 select coalesce(jsonb_agg(jsonb_build_object('date',e->>'date','windows',(select coalesce(jsonb_agg(w order by (w->>'startMinute')::numeric::int),'[]') from jsonb_array_elements(e->'windows') w)) order by e->>'date'),'[]') into overrides from jsonb_array_elements(p_definition->'exceptions') e;
 return jsonb_build_object('name',btrim(p_definition->>'name'),'timezone',p_definition->>'timezone','weekly',week,'exceptions',overrides);
end $$;
revoke all on function public.learn_work_calendar_validate(jsonb) from public,anon,authenticated,service_role;

-- Evaluate real UTC minutes in the named local clock. Repeated DST minutes count
-- twice if both are inside the schedule; nonexistent minutes never exist. This
-- avoids guessing which UTC instant an ambiguous local boundary meant.
create function public.learn_work_calendar_expand(p_definition jsonb,p_start timestamptz,p_end timestamptz) returns jsonb
language plpgsql stable set search_path=public,pg_temp set timezone='UTC' as $$
declare def jsonb:=learn_work_calendar_validate(p_definition);answer jsonb;begin
 if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<=p_start
  or p_end-p_start>interval '366 days' or p_start<timestamptz '2000-01-01 00:00:00+00' or p_end>timestamptz '2201-01-01 00:00:00+00' then
  raise exception 'Calendar period must be finite and at most 366 days' using errcode='22023';end if;
 with weekly as materialized(select (w->>'day')::numeric::int as weekday,(w->>'startMinute')::numeric::int a,(w->>'endMinute')::numeric::int b from jsonb_array_elements(def->'weekly') w),
 overrides as materialized(select (e->>'date')::date as calendar_date,e->'windows' windows from jsonb_array_elements(def->'exceptions') e),
 minutes as materialized(select t,t at time zone (def->>'timezone') local_time from generate_series(date_trunc('minute',p_start),p_end,interval '1 minute') t where t<p_end),
 selected as (select m.t from minutes m left join overrides o on o.calendar_date=m.local_time::date
  where case when o.calendar_date is not null then exists(select 1 from jsonb_array_elements(o.windows) w where extract(hour from m.local_time)*60+extract(minute from m.local_time)>=(w->>'startMinute')::numeric::int and extract(hour from m.local_time)*60+extract(minute from m.local_time)<(w->>'endMinute')::numeric::int)
   else exists(select 1 from weekly w where w.weekday=extract(isodow from m.local_time) and extract(hour from m.local_time)*60+extract(minute from m.local_time)>=w.a and extract(hour from m.local_time)*60+extract(minute from m.local_time)<w.b) end),
 islands as (select t,t-row_number() over(order by t)*interval '1 minute' island from selected),
 windows as (select greatest(min(t),p_start) a,least(max(t)+interval '1 minute',p_end) b from islands group by island)
 select coalesce(jsonb_agg(jsonb_build_object('start',a,'end',b) order by a),'[]') into answer from windows;
 return answer;
end $$;
revoke all on function public.learn_work_calendar_expand(jsonb,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create function public.learn_work_calendar_version_result(v public.learn_work_calendar_versions) returns jsonb
language sql stable set search_path=public,pg_temp as $$select jsonb_build_object('id',v.id,'tenantId',v.tenant_id,'revision',v.revision,'definition',v.definition,'recordedAt',v.recorded_at,'recordedBy',v.actor_id,'reason',v.reason)$$;
revoke all on function public.learn_work_calendar_version_result(public.learn_work_calendar_versions) from public,anon,authenticated,service_role;

-- Canonical identity is shared by writes and resolution; missing/extra fields
-- cannot silently change the meaning of a retained browser request.
create function public.learn_work_calendar_request(p_tenant uuid,p_actor uuid,p_kind text,p_payload jsonb) returns jsonb
language plpgsql stable set search_path=public,pg_temp as $$
declare payload jsonb;n numeric;v uuid;previous uuid;begin
 if p_kind is null or p_kind not in ('save','publish') or jsonb_typeof(p_payload) is distinct from 'object'
  or octet_length(p_payload::text)>270336 then raise exception 'Invalid calendar recovery request' using errcode='22023';end if;
 if jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(btrim(p_payload->>'reason')) not between 1 and 1000 then
  raise exception 'Calendar reason required' using errcode='22023';end if;
 if p_kind='save' then
  if (select count(*) from jsonb_object_keys(p_payload))<>3
   or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('expectedRevision','definition','reason'))
   or jsonb_typeof(p_payload->'expectedRevision') is distinct from 'number' then
   raise exception 'Calendar save descriptor required' using errcode='22023';end if;
  n:=(p_payload->>'expectedRevision')::numeric;
  if n<0 or n>=2147483647 or mod(n,1)<>0 then raise exception 'Invalid calendar revision' using errcode='22023';end if;
  payload:=jsonb_build_object('expectedRevision',n::integer,'definition',learn_work_calendar_validate(p_payload->'definition'),'reason',btrim(p_payload->>'reason'));
 else
  if (select count(*) from jsonb_object_keys(p_payload))<>3
   or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('versionId','expectedPublication','reason'))
   or jsonb_typeof(p_payload->'versionId') is distinct from 'string'
   or jsonb_typeof(p_payload->'expectedPublication') not in ('string','null') then
   raise exception 'Calendar publication descriptor required' using errcode='22023';end if;
  v:=(p_payload->>'versionId')::uuid;previous:=(p_payload->>'expectedPublication')::uuid;
  payload:=jsonb_build_object('versionId',v,'expectedPublication',previous,'reason',btrim(p_payload->>'reason'));
 end if;
 return jsonb_build_object('tenantId',p_tenant,'actorId',p_actor)||payload;
end $$;
revoke all on function public.learn_work_calendar_request(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;

create function public.learn_work_calendar_resolve(p_tenant uuid,p_kind text,p_request uuid,p_payload jsonb,p_cancel boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);descriptor jsonb;retained jsonb;retained_kind text;
 at_time timestamptz;outcome text:='pending';begin
 if p_request is null or p_cancel is null then raise exception 'Calendar request and resolution action required' using errcode='22023';end if;
 descriptor:=learn_work_calendar_request(p_tenant,actor,p_kind,p_payload);
 perform pg_advisory_xact_lock(hashtextextended('learn-calendar-request:'||p_request::text,0));
 select request,'save',recorded_at into retained,retained_kind,at_time from learn_work_calendar_versions where id=p_request;
 if not found then
  select request,'publish',effective_from into retained,retained_kind,at_time from learn_work_calendar_publications where id=p_request;
 end if;
 if found then outcome:='recorded';else
  select request,kind,recorded_at into retained,retained_kind,at_time from learn_work_calendar_cancellations where id=p_request;
  if found then outcome:='cancelled';end if;
 end if;
 if outcome<>'pending' then
  if retained_kind is distinct from p_kind or retained is distinct from descriptor then raise exception 'Calendar request changed' using errcode='PT409';end if;
 elsif p_cancel then
  insert into learn_work_calendar_cancellations(id,tenant_id,actor_id,kind,request)
   values(p_request,p_tenant,actor,p_kind,descriptor) returning recorded_at into at_time;
  outcome:='cancelled';
 end if;
 perform learn_work_collection_access(p_tenant);
 return jsonb_build_object('contract','work-calendar-resolution@1','tenantId',p_tenant,'actorId',actor,
  'requestId',p_request,'kind',p_kind,'payload',descriptor-'tenantId'-'actorId','state',outcome,'recordedAt',at_time);
end $$;
revoke all on function public.learn_work_calendar_resolve(uuid,text,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_calendar_resolve(uuid,text,uuid,jsonb,boolean) to authenticated;

create function public.learn_work_calendar_save(p_tenant uuid,p_expected_revision integer,p_definition jsonb,p_request uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);def jsonb:=learn_work_calendar_validate(p_definition);r learn_work_calendar_versions%rowtype;descriptor jsonb;n integer;begin
 if p_request is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=2147483647 or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Calendar revision, request and reason required' using errcode='22023';end if;
 descriptor:=learn_work_calendar_request(p_tenant,actor,'save',jsonb_build_object('expectedRevision',p_expected_revision,'definition',def,'reason',p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-calendar-request:'||p_request::text,0));
 if exists(select 1 from learn_work_calendar_cancellations where id=p_request) then raise exception 'Calendar request cancelled' using errcode='PT409';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-calendar-tenant:'||p_tenant::text,0));
 select * into r from learn_work_calendar_versions where id=p_request;
 if found then
  if r.request is distinct from descriptor then raise exception 'Calendar request changed' using errcode='PT409';end if;
 else
  if exists(select 1 from learn_work_calendar_publications where id=p_request) then raise exception 'Calendar request already used' using errcode='PT409';end if;
  select coalesce(max(revision),0) into n from learn_work_calendar_versions where tenant_id=p_tenant;
  if n<>p_expected_revision then raise exception 'Calendar revision changed' using errcode='PT409';end if;
  insert into learn_work_calendar_versions(id,tenant_id,revision,definition,actor_id,reason,request)
   values(p_request,p_tenant,n+1,def,actor,btrim(p_reason),descriptor) returning * into r;
 end if;
 perform learn_work_collection_access(p_tenant);
 return jsonb_build_object('contract','work-calendar@1','version',learn_work_calendar_version_result(r));
end $$;
revoke all on function public.learn_work_calendar_save(uuid,integer,jsonb,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_calendar_save(uuid,integer,jsonb,uuid,text) to authenticated;

create function public.learn_work_calendar_publish(p_tenant uuid,p_version uuid,p_expected_publication uuid,p_request uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);v learn_work_calendar_versions%rowtype;r learn_work_calendar_publications%rowtype;previous learn_work_calendar_publications%rowtype;descriptor jsonb;at_time timestamptz;begin
 if p_version is null or p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Calendar version, request and reason required' using errcode='22023';end if;
 descriptor:=learn_work_calendar_request(p_tenant,actor,'publish',jsonb_build_object('versionId',p_version,'expectedPublication',p_expected_publication,'reason',p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-calendar-request:'||p_request::text,0));
 if exists(select 1 from learn_work_calendar_cancellations where id=p_request) then raise exception 'Calendar request cancelled' using errcode='PT409';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-calendar-tenant:'||p_tenant::text,0));
 select * into r from learn_work_calendar_publications where id=p_request;
 if found then
  if r.request is distinct from descriptor then raise exception 'Publication request changed' using errcode='PT409';end if;
 else
  if exists(select 1 from learn_work_calendar_versions where id=p_request) then raise exception 'Calendar request already used' using errcode='PT409';end if;
  select * into v from learn_work_calendar_versions where tenant_id=p_tenant order by revision desc limit 1;
  if v.id is distinct from p_version then raise exception 'Only the latest saved calendar may be published' using errcode='PT409';end if;
  select * into previous from learn_work_calendar_publications where tenant_id=p_tenant order by effective_from desc limit 1;
  if previous.id is distinct from p_expected_publication or exists(select 1 from learn_work_calendar_publications where tenant_id=p_tenant and version_id=p_version) then raise exception 'Published calendar changed or already active' using errcode='PT409';end if;
  at_time:=clock_timestamp();
  if previous.effective_from>=at_time then raise exception 'Calendar publication clock must advance' using errcode='55000';end if;
  insert into learn_work_calendar_publications(id,tenant_id,version_id,actor_id,reason,request,effective_from)
   values(p_request,p_tenant,p_version,actor,btrim(p_reason),descriptor,at_time) returning * into r;
 end if;
 perform learn_work_collection_access(p_tenant);
 return jsonb_build_object('contract','work-calendar-publication@1','id',r.id,'tenantId',r.tenant_id,'versionId',r.version_id,'effectiveFrom',r.effective_from,'recordedBy',r.actor_id,'reason',r.reason);
end $$;
revoke all on function public.learn_work_calendar_publish(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_calendar_publish(uuid,uuid,uuid,uuid,text) to authenticated;

create function public.learn_work_calendar_read(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);v learn_work_calendar_versions%rowtype;p learn_work_calendar_publications%rowtype;active_version learn_work_calendar_versions%rowtype;begin
 select * into v from learn_work_calendar_versions where tenant_id=p_tenant order by revision desc limit 1;
 select * into p from learn_work_calendar_publications where tenant_id=p_tenant order by effective_from desc limit 1;
 if p.id is not null then select * into active_version from learn_work_calendar_versions where tenant_id=p_tenant and id=p.version_id;end if;
 return jsonb_build_object('contract','work-calendar-read@1','tenantId',p_tenant,'draft',case when v.id is not null then learn_work_calendar_version_result(v) end,
  'publication',case when p.id is not null then jsonb_build_object('id',p.id,'effectiveFrom',p.effective_from,'recordedBy',p.actor_id,'reason',p.reason,'version',learn_work_calendar_version_result(active_version)) end);
end $$;
revoke all on function public.learn_work_calendar_read(uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_calendar_read(uuid) to authenticated;

create function public.learn_work_calendar_preview(p_tenant uuid,p_version uuid,p_start timestamptz,p_end timestamptz) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);v learn_work_calendar_versions%rowtype;windows jsonb;begin
 select * into v from learn_work_calendar_versions where tenant_id=p_tenant and id=p_version;
 if not found then raise exception 'Saved calendar unavailable' using errcode='42501';end if;
 windows:=learn_work_calendar_expand(v.definition,p_start,p_end);
 return jsonb_build_object('contract','work-calendar-preview@1','tenantId',p_tenant,'version',learn_work_calendar_version_result(v),'simulation',true,
  'period',jsonb_build_object('start',p_start,'end',p_end),'windows',windows,
  'minutes',(select coalesce(sum(extract(epoch from (w->>'end')::timestamptz-(w->>'start')::timestamptz)/60),0) from jsonb_array_elements(windows) w));
end $$;
revoke all on function public.learn_work_calendar_preview(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_calendar_preview(uuid,uuid,timestamptz,timestamptz) to authenticated;

-- Private source for future collection integration; no saved draft or later
-- publication can silently fill historical gaps in a frozen run.
create function public.learn_work_calendar_snapshot(p_tenant uuid,p_start timestamptz,p_end timestamptz,p_observed timestamptz) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);first_at timestamptz;r record;versions jsonb:='[]';windows jsonb:='[]';part jsonb;n integer:=0;begin
 if p_observed is null or not isfinite(p_observed) or p_observed>clock_timestamp() or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_end<=p_start or p_end>p_observed or p_end-p_start>interval '366 days' then raise exception 'Invalid calendar snapshot period' using errcode='22023';end if;
 select min(effective_from) into first_at from learn_work_calendar_publications where tenant_id=p_tenant and effective_from<=p_observed;
 for r in with history as (select p.*,lead(effective_from) over(order by effective_from) next_at from learn_work_calendar_publications p where tenant_id=p_tenant and effective_from<=p_observed)
  select h.*,v.definition,v.revision,greatest(h.effective_from,p_start) start_at,least(coalesce(h.next_at,p_end),p_end) end_at
   from history h join learn_work_calendar_versions v on v.tenant_id=p_tenant and v.id=h.version_id
   where h.effective_from<p_end and coalesce(h.next_at,p_end)>p_start order by h.effective_from loop
  n:=n+1;if n>100 then raise exception 'Calendar publication history exceeds supported limit' using errcode='54000';end if;
  part:=learn_work_calendar_expand(r.definition,r.start_at,r.end_at);
  versions:=versions||jsonb_build_array(jsonb_build_object('publicationId',r.id,'versionId',r.version_id,'revision',r.revision,'definition',r.definition,
   'effectiveFrom',r.effective_from,'start',r.start_at,'end',r.end_at,'recordedBy',r.actor_id,'reason',r.reason));
  windows:=windows||part;
 end loop;
 return jsonb_build_object('contract','work-calendar-snapshot@1','tenantId',p_tenant,'observedAt',p_observed,
  'period',jsonb_build_object('start',p_start,'end',p_end),'complete',coalesce(first_at<=p_start,false),
  'missing',case when first_at is null or first_at>p_start then jsonb_build_array(jsonb_build_object('start',p_start,'end',least(coalesce(first_at,p_end),p_end))) else '[]'::jsonb end,
  'versions',versions,'windows',windows);
end $$;
revoke all on function public.learn_work_calendar_snapshot(uuid,timestamptz,timestamptz,timestamptz) from public,anon,authenticated,service_role;

-- SOURCE supabase/migrations/20261101110000_learn_work_delays.sql
-- Candidate: explicit owner-reviewed delay exclusions. No source or score writes.
create table public.learn_work_delay_events (
 id uuid primary key,tenant_id uuid not null references public.tenants(id),object_id uuid not null,
 revision integer not null check(revision>0),decision text not null check(decision in ('approve','reverse')),
 approval_id uuid,window_start timestamptz not null,window_end timestamptz not null,
 label text not null check(length(btrim(label)) between 1 and 200),
 reason text not null check(length(btrim(reason)) between 1 and 1000),
 evidence_ids uuid[] not null,actor_id uuid not null references public.profiles(id),
 recorded_at timestamptz not null default clock_timestamp(),request jsonb not null,proof jsonb,
 unique(tenant_id,object_id,revision),unique(tenant_id,object_id,id),unique(approval_id),
 foreign key(tenant_id,object_id,approval_id) references public.learn_work_delay_events(tenant_id,object_id,id),
 check(isfinite(window_start) and isfinite(window_end) and window_start<window_end and window_end<=recorded_at),
 check((decision='approve' and approval_id is null and proof is not null and cardinality(evidence_ids) between 1 and 50)
    or (decision='reverse' and approval_id is not null and proof is null and cardinality(evidence_ids)=0)),
 check(proof is null or octet_length(proof::text)<=2097152)
);
create index learn_work_delay_scope on public.learn_work_delay_events(tenant_id,object_id,recorded_at,revision);
create table public.learn_work_delay_cancellations (
 id uuid primary key,tenant_id uuid not null references public.tenants(id),object_id uuid not null,
 actor_id uuid not null references public.profiles(id),request jsonb not null,recorded_at timestamptz not null default clock_timestamp()
);
alter table public.learn_work_delay_events enable row level security;
alter table public.learn_work_delay_cancellations enable row level security;
revoke all on public.learn_work_delay_events,public.learn_work_delay_cancellations from public,anon,authenticated,service_role;
grant select on public.learn_work_delay_events,public.learn_work_delay_cancellations to authenticated;
create policy learn_work_delay_events_read on public.learn_work_delay_events for select to authenticated
 using(tenant_id=current_tenant_id() and coalesce(current_user_role(),'') in ('owner','admin'));
create policy learn_work_delay_cancellations_read on public.learn_work_delay_cancellations for select to authenticated
 using(tenant_id=current_tenant_id() and coalesce(current_user_role(),'') in ('owner','admin'));
create function public.learn_work_delay_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$begin
 raise exception 'Delay review evidence is immutable' using errcode='55000';end $$;
revoke all on function public.learn_work_delay_immutable() from public,anon,authenticated,service_role;
create trigger learn_work_delay_events_immutable before update or delete on public.learn_work_delay_events for each row execute function public.learn_work_delay_immutable();
create trigger learn_work_delay_events_no_truncate before truncate on public.learn_work_delay_events for each statement execute function public.learn_work_delay_immutable();
create trigger learn_work_delay_cancellations_immutable before update or delete on public.learn_work_delay_cancellations for each row execute function public.learn_work_delay_immutable();
create trigger learn_work_delay_cancellations_no_truncate before truncate on public.learn_work_delay_cancellations for each statement execute function public.learn_work_delay_immutable();

-- Canonical descriptor is shared by record and recovery. Recovery validates syntax
-- without requiring current source data/heads, so a stale unsent request can end.
create function public.learn_work_delay_request(p_tenant uuid,p_actor uuid,p_payload jsonb) returns jsonb
language plpgsql stable set search_path=public,pg_temp set timezone='UTC' as $$
declare o uuid;n numeric;a uuid;s timestamptz;e timestamptz;ids uuid[];begin
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>32768 then raise exception 'Invalid delay request' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p_payload))<>8 or exists(select 1 from jsonb_object_keys(p_payload) k
   where k not in ('objectId','expectedRevision','decision','approvalId','period','label','evidenceIds','reason'))
  or jsonb_typeof(p_payload->'objectId') is distinct from 'string'
  or jsonb_typeof(p_payload->'expectedRevision') is distinct from 'number'
  or coalesce(p_payload->>'decision','') not in ('approve','reverse')
  or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(btrim(p_payload->>'reason')) not between 1 and 1000
  or jsonb_typeof(p_payload->'evidenceIds') is distinct from 'array' then raise exception 'Complete delay review descriptor required' using errcode='22023';end if;
 o:=(p_payload->>'objectId')::uuid;n:=(p_payload->>'expectedRevision')::numeric;
 if n<0 or n>=2147483647 or mod(n,1)<>0 then raise exception 'Invalid delay revision' using errcode='22023';end if;
 if p_payload->>'decision'='approve' then
  if p_payload->'approvalId' is distinct from 'null'::jsonb or jsonb_typeof(p_payload->'period') is distinct from 'object'
   or jsonb_typeof(p_payload->'label') is distinct from 'string' or length(btrim(p_payload->>'label')) not between 1 and 200
   or jsonb_array_length(p_payload->'evidenceIds') not between 1 and 50 then raise exception 'Delay interval, label and captured evidence required' using errcode='22023';end if;
  if (select count(*) from jsonb_object_keys(p_payload->'period'))<>2 or exists(select 1 from jsonb_object_keys(p_payload->'period') k where k not in ('start','end'))
   or jsonb_typeof(p_payload#>'{period,start}') is distinct from 'string' or jsonb_typeof(p_payload#>'{period,end}') is distinct from 'string'
   or (p_payload#>>'{period,start}')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' or (p_payload#>>'{period,end}')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Explicit interval timezone required' using errcode='22023';end if;
  s:=(p_payload#>>'{period,start}')::timestamptz;e:=(p_payload#>>'{period,end}')::timestamptz;
  if s is null or e is null or not isfinite(s) or not isfinite(e) or s>=e or e-s>interval '366 days'
   or s<timestamptz '2000-01-01T00:00:00Z' or e>timestamptz '2201-01-01T00:00:00Z' then raise exception 'Invalid delay interval' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'evidenceIds') x where jsonb_typeof(x) is distinct from 'string') then raise exception 'Captured evidence IDs required' using errcode='22023';end if;
  select array_agg(value::uuid order by value::uuid) into ids from jsonb_array_elements_text(p_payload->'evidenceIds');
  if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Duplicate delay evidence' using errcode='22023';end if;
 else
  if jsonb_typeof(p_payload->'approvalId') is distinct from 'string' or p_payload->'period' is distinct from 'null'::jsonb
   or p_payload->'label' is distinct from 'null'::jsonb or p_payload->'evidenceIds'<>'[]'::jsonb then raise exception 'Reversal must reference the original approval' using errcode='22023';end if;
  a:=(p_payload->>'approvalId')::uuid;ids:='{}';
 end if;
 return jsonb_build_object('tenantId',p_tenant,'actorId',p_actor,'objectId',o,'expectedRevision',n::integer,
  'decision',p_payload->>'decision','approvalId',a,'period',case when s is not null then jsonb_build_object('start',s,'end',e) end,
  'label',case when s is not null then btrim(p_payload->>'label') end,'evidenceIds',to_jsonb(ids),'reason',btrim(p_payload->>'reason'));
end $$;
revoke all on function public.learn_work_delay_request(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.learn_work_delay_entry(r public.learn_work_delay_events) returns jsonb
language sql stable set search_path=public,pg_temp as $$select jsonb_build_object('id',r.id,'tenantId',r.tenant_id,'objectId',r.object_id,
 'revision',r.revision,'decision',r.decision,'approvalId',r.approval_id,'period',jsonb_build_object('start',r.window_start,'end',r.window_end),
 'label',r.label,'reason',r.reason,'evidenceIds',to_jsonb(r.evidence_ids),'recordedBy',r.actor_id,'recordedAt',r.recorded_at)$$;
revoke all on function public.learn_work_delay_entry(public.learn_work_delay_events) from public,anon,authenticated,service_role;

create function public.learn_work_delay_record(p_tenant uuid,p_request uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);descriptor jsonb;item uuid;r learn_work_delay_events%rowtype;
 original learn_work_delay_events%rowtype;n integer;s timestamptz;e timestamptz;capture jsonb;ids uuid[];at_time timestamptz;begin
 if p_request is null then raise exception 'Delay request identity required' using errcode='22023';end if;
 descriptor:=learn_work_delay_request(p_tenant,actor,p_payload);item:=(descriptor->>'objectId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('learn-delay-request:'||p_request::text,0));
 if exists(select 1 from learn_work_delay_cancellations where id=p_request) then raise exception 'Delay request cancelled' using errcode='PT409';end if;
 select * into r from learn_work_delay_events where id=p_request;
 if found then
  if r.request is distinct from descriptor then raise exception 'Delay request changed' using errcode='PT409';end if;
 else
  perform pg_advisory_xact_lock(hashtextextended('learn-delay-object:'||p_tenant::text||':'||item::text,0));
  select coalesce(max(revision),0) into n from learn_work_delay_events where tenant_id=p_tenant and object_id=item;
  if n<>(descriptor->>'expectedRevision')::integer then raise exception 'Delay review history changed' using errcode='PT409';end if;
  if descriptor->>'decision'='approve' then
   s:=(descriptor#>>'{period,start}')::timestamptz;e:=(descriptor#>>'{period,end}')::timestamptz;
   if e>statement_timestamp() then raise exception 'Review a completed delay interval' using errcode='22023';end if;
   -- Hold the actual object stable while the existing reader checks its capture.
   perform 1 from intelligence_objects where id=item and tenant_id=p_tenant for share;
   if not found then raise exception 'Work item unavailable in this company' using errcode='22023';end if;
   capture:=learn_work_history_read(p_tenant,item,s,e);
   if capture->>'coverageStart' is null or (capture->>'coverageStart')::timestamptz>s
    or (capture->>'count')::integer=0 then raise exception 'Continuous captured history is required for a delay approval' using errcode='22023';end if;
   select array_agg(value::uuid order by value::uuid) into ids from jsonb_array_elements_text(descriptor->'evidenceIds');
   if exists(select 1 from unnest(ids) x where not exists(select 1 from jsonb_array_elements(capture->'events') ev where ev->>'id'=x::text)) then
    raise exception 'Delay evidence must come from this work item and review interval' using errcode='22023';end if;
   at_time:=clock_timestamp();
   if exists(select 1 from learn_work_delay_events where tenant_id=p_tenant and object_id=item and recorded_at>=at_time) then raise exception 'Delay review clock must advance' using errcode='55000';end if;
   insert into learn_work_delay_events(id,tenant_id,object_id,revision,decision,window_start,window_end,label,reason,evidence_ids,actor_id,recorded_at,request,proof)
    values(p_request,p_tenant,item,n+1,'approve',s,e,descriptor->>'label',descriptor->>'reason',ids,actor,at_time,descriptor,capture) returning * into r;
  else
   select * into original from learn_work_delay_events where id=(descriptor->>'approvalId')::uuid and tenant_id=p_tenant and object_id=item and decision='approve';
   if not found or exists(select 1 from learn_work_delay_events where approval_id=original.id) then raise exception 'Original delay approval missing or already reversed' using errcode='PT409';end if;
   at_time:=clock_timestamp();
   if exists(select 1 from learn_work_delay_events where tenant_id=p_tenant and object_id=item and recorded_at>=at_time) then raise exception 'Delay review clock must advance' using errcode='55000';end if;
   if at_time<=original.recorded_at then raise exception 'Delay review clock must advance' using errcode='55000';end if;
   insert into learn_work_delay_events(id,tenant_id,object_id,revision,decision,approval_id,window_start,window_end,label,reason,evidence_ids,actor_id,recorded_at,request)
    values(p_request,p_tenant,item,n+1,'reverse',original.id,original.window_start,original.window_end,original.label,descriptor->>'reason','{}',actor,at_time,descriptor) returning * into r;
  end if;
 end if;
 perform learn_work_collection_access(p_tenant);
 return jsonb_build_object('contract','work-delay-record@1','entry',learn_work_delay_entry(r));
end $$;
revoke all on function public.learn_work_delay_record(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_delay_record(uuid,uuid,jsonb) to authenticated;

create function public.learn_work_delay_resolve(p_tenant uuid,p_request uuid,p_payload jsonb,p_cancel boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);descriptor jsonb;retained jsonb;outcome text:='pending';at_time timestamptz;begin
 if p_request is null or p_cancel is null then raise exception 'Delay request and recovery action required' using errcode='22023';end if;
 descriptor:=learn_work_delay_request(p_tenant,actor,p_payload);
 perform pg_advisory_xact_lock(hashtextextended('learn-delay-request:'||p_request::text,0));
 select request,recorded_at into retained,at_time from learn_work_delay_events where id=p_request;
 if found then outcome:='recorded';else
  select request,recorded_at into retained,at_time from learn_work_delay_cancellations where id=p_request;
  if found then outcome:='cancelled';end if;
 end if;
 if outcome<>'pending' then
  if retained is distinct from descriptor then raise exception 'Delay request changed' using errcode='PT409';end if;
 elsif p_cancel then
  insert into learn_work_delay_cancellations(id,tenant_id,object_id,actor_id,request)
   values(p_request,p_tenant,(descriptor->>'objectId')::uuid,actor,descriptor) returning recorded_at into at_time;
  outcome:='cancelled';
 end if;
 perform learn_work_collection_access(p_tenant);
 return jsonb_build_object('contract','work-delay-resolution@1','tenantId',p_tenant,'actorId',actor,'requestId',p_request,
  'payload',descriptor-'tenantId'-'actorId','state',outcome,'recordedAt',at_time);
end $$;
revoke all on function public.learn_work_delay_resolve(uuid,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_delay_resolve(uuid,uuid,jsonb,boolean) to authenticated;

-- Fixed revision pagination returns all decisions, including reversals. Large
-- proofs are read separately so a page never expands every captured work history.
create function public.learn_work_delay_read(p_tenant uuid,p_object uuid,p_after integer,p_through integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);head integer;rows jsonb;last_revision integer;begin
 if p_object is null or p_after is null or p_after<0 then raise exception 'Delay object and cursor required' using errcode='22023';end if;
 select coalesce(max(revision),0) into head from learn_work_delay_events where tenant_id=p_tenant and object_id=p_object;
 if p_through is not null then
  if p_through<0 or p_through>head then raise exception 'Invalid retained delay head' using errcode='22023';end if;
  head:=p_through;
 end if;
 if p_after>head then raise exception 'Delay cursor exceeds retained head' using errcode='22023';end if;
 select coalesce(jsonb_agg(learn_work_delay_entry(r) order by revision),'[]'),coalesce(max(revision),p_after) into rows,last_revision
 from (select * from learn_work_delay_events where tenant_id=p_tenant and object_id=p_object and revision>p_after and revision<=head order by revision limit 100) r;
 return jsonb_build_object('contract','work-delay-page@1','tenantId',p_tenant,'objectId',p_object,'after',p_after,'through',head,'next',last_revision,
  'hasMore',last_revision<head,'entries',rows);
end $$;
revoke all on function public.learn_work_delay_read(uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_delay_read(uuid,uuid,integer,integer) to authenticated;

create function public.learn_work_delay_evidence(p_tenant uuid,p_object uuid,p_approval uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);r learn_work_delay_events%rowtype;begin
 select * into r from learn_work_delay_events where id=p_approval and tenant_id=p_tenant and object_id=p_object and decision='approve';
 if not found then raise exception 'Delay approval unavailable in this work item' using errcode='22023';end if;
 return jsonb_build_object('contract','work-delay-evidence@1','tenantId',p_tenant,'objectId',p_object,'approval',learn_work_delay_entry(r),'capture',r.proof);
end $$;
revoke all on function public.learn_work_delay_evidence(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_delay_evidence(uuid,uuid,uuid) to authenticated;

-- Future collectors must retain this snapshot alongside calendar/work/roster
-- inputs. Reversals affect new snapshots; existing receipts are never rewritten.
create function public.learn_work_delay_snapshot(p_tenant uuid,p_object uuid,p_start timestamptz,p_end timestamptz,p_observed timestamptz) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);head integer;approvals jsonb;windows jsonb;n integer;begin
 if p_object is null or p_start is null or p_end is null or p_observed is null or not isfinite(p_start) or not isfinite(p_end) or not isfinite(p_observed)
  or p_start>=p_end or p_end>p_observed or p_observed>clock_timestamp() or p_end-p_start>interval '366 days' then raise exception 'Invalid delay snapshot period' using errcode='22023';end if;
 select coalesce(max(revision),0) into head from learn_work_delay_events where tenant_id=p_tenant and object_id=p_object and recorded_at<=p_observed;
 select count(*) into n from learn_work_delay_events a where a.tenant_id=p_tenant and a.object_id=p_object and a.revision<=head and a.decision='approve'
  and a.window_start<p_end and a.window_end>p_start and not exists(select 1 from learn_work_delay_events r where r.approval_id=a.id and r.revision<=head);
 if n>1000 then raise exception 'Delay evidence exceeds one item snapshot limit' using errcode='54000';end if;
 select coalesce(jsonb_agg(learn_work_delay_entry(a) order by a.revision),'[]') into approvals from learn_work_delay_events a
  where a.tenant_id=p_tenant and a.object_id=p_object and a.revision<=head and a.decision='approve' and a.window_start<p_end and a.window_end>p_start
   and not exists(select 1 from learn_work_delay_events r where r.approval_id=a.id and r.revision<=head);
 -- Union overlapping intervals once before ownership/calendar intersection.
 with spans as (select greatest((v#>>'{period,start}')::timestamptz,p_start) s,least((v#>>'{period,end}')::timestamptz,p_end) e from jsonb_array_elements(approvals) v),
 prior as (select s,e,max(e) over(order by s,e rows between unbounded preceding and 1 preceding) previous_end from spans),
 labelled as (select s,e,sum(case when previous_end is null or s>previous_end then 1 else 0 end) over(order by s,e) grp from prior),
 merged as (select min(s) s,max(e) e from labelled group by grp)
 select coalesce(jsonb_agg(jsonb_build_object('start',s,'end',e) order by s),'[]') into windows from merged;
 return jsonb_build_object('contract','work-delay-snapshot@1','tenantId',p_tenant,'objectId',p_object,'through',head,'observedAt',p_observed,
  'period',jsonb_build_object('start',p_start,'end',p_end),'approvals',approvals,'windows',windows);
end $$;
revoke all on function public.learn_work_delay_snapshot(uuid,uuid,timestamptz,timestamptz,timestamptz) from public,anon,authenticated,service_role;

-- SOURCE supabase/migrations/20261101120000_learn_working_time_calculation.sql
-- Private deterministic calculation over frozen inputs. No public RPC, writes,
-- new authority or change to elapsed-residence semantics is introduced here.
create function public.learn_working_time_ranges(p_windows jsonb,p_start timestamptz,p_end timestamptz)
returns tstzmultirange language plpgsql immutable set search_path=public,pg_temp set timezone='UTC' as $$
declare w jsonb;a timestamptz;b timestamptz;answer tstzmultirange;begin
 if jsonb_typeof(p_windows) is distinct from 'array' or p_start is null or p_end is null
  or not isfinite(p_start) or not isfinite(p_end) or p_start>=p_end then
  raise exception 'Invalid working-time windows' using errcode='22023';end if;
 if jsonb_array_length(p_windows)>10000 then raise exception 'Working-time windows exceed review bound' using errcode='54000';end if;
 for w in select value from jsonb_array_elements(p_windows) loop
  if jsonb_typeof(w) is distinct from 'object' or not(w ?& array['start','end'])
   or exists(select 1 from jsonb_object_keys(w) k where k not in ('start','end'))
   or jsonb_typeof(w->'start') is distinct from 'string' or jsonb_typeof(w->'end') is distinct from 'string'
   or (w->>'start')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
   or (w->>'end')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
   raise exception 'Invalid working-time boundary' using errcode='22023';end if;
  a:=(w->>'start')::timestamptz;b:=(w->>'end')::timestamptz;
  if not isfinite(a) or not isfinite(b) or a>=b or a<p_start or b>p_end then
   raise exception 'Working-time window is outside its period' using errcode='22023';end if;
 end loop;
 select coalesce(range_agg(tstzrange((v->>'start')::timestamptz,(v->>'end')::timestamptz,'[)')),'{}'::tstzmultirange)
 into answer from jsonb_array_elements(p_windows) v;
 return answer;
end $$;
create function public.learn_working_time_windows(p_ranges tstzmultirange) returns jsonb
language sql immutable set search_path=public,pg_temp set timezone='UTC' as $$
 select coalesce(jsonb_agg(jsonb_build_object('start',lower(r),'end',upper(r)) order by lower(r)),'[]') from unnest(p_ranges) r;
$$;
create function public.learn_working_time_micros(p_ranges tstzmultirange) returns numeric
language sql immutable set search_path=public,pg_temp as $$
 select coalesce(sum(extract(epoch from upper(r)-lower(r))*1000000),0) from unnest(p_ranges) r;
$$;

create function public.learn_working_time_calculate(
 p_tenant uuid,p_kind text,p_subject uuid,p_history jsonb,p_roster jsonb,p_teams jsonb,
 p_start timestamptz,p_end timestamptz,p_observed timestamptz,p_first_kind text,
 p_states jsonb,p_calendar jsonb,p_delay jsonb)
returns jsonb language plpgsql immutable set search_path=public,pg_temp set timezone='UTC' as $$
declare object_id uuid;v jsonb;segment jsonb;segments jsonb:='[]';base jsonb;answer jsonb;states jsonb;
 whole tstzmultirange;calendar_ranges tstzmultirange;calendar_coverage tstzmultirange;missing_ranges tstzmultirange;
 delay_ranges tstzmultirange;approval_ranges tstzmultirange;owned tstzmultirange:='{}';selected_owned tstzmultirange:='{}';
 span tstzmultirange;business tstzmultirange;excluded tstzmultirange;assessed tstzmultirange;
 all_business tstzmultirange:='{}';all_excluded tstzmultirange:='{}';all_assessed tstzmultirange:='{}';
 is_selected boolean;ownership_complete boolean;calendar_complete boolean;complete boolean;eligible boolean;
 raw_micros numeric:=0;owned_micros numeric;selected_micros numeric;business_micros numeric;excluded_micros numeric;assessed_micros numeric;
 reasons jsonb:='[]';period jsonb;
begin
 if p_tenant is null or p_subject is null or p_kind is null or p_kind not in ('member','team')
  or p_start is null or p_end is null or p_observed is null or not isfinite(p_start) or not isfinite(p_end) or not isfinite(p_observed)
  or p_start>=p_end or p_end>p_observed or p_end-p_start>interval '366 days'
  or (p_first_kind is not null and p_first_kind not in ('insert','baseline')) then
  raise exception 'Invalid working-time calculation scope' using errcode='22023';end if;
 if jsonb_typeof(p_states) is distinct from 'array' then raise exception 'Explicit work states required' using errcode='22023';end if;
 if jsonb_array_length(p_states) not between 1 and 50 or exists(select 1 from jsonb_array_elements(p_states) s
  where jsonb_typeof(s) is distinct from 'string' or length(s#>>'{}') not between 1 and 200 or btrim(s#>>'{}') is distinct from s#>>'{}')
  or (select count(distinct value)<>count(*) from jsonb_array_elements(p_states)) then
  raise exception 'Choose unique explicit work states' using errcode='22023';end if;
 select jsonb_agg(value order by value) into states from jsonb_array_elements(p_states);
 object_id:=(p_history->>'objectId')::uuid;
 if object_id is null or jsonb_typeof(p_history->'events') is distinct from 'array'
  or jsonb_array_length(p_history->'events') is distinct from (p_history->>'count')::int
  or jsonb_typeof(p_roster->'members') is distinct from 'array' or p_roster->>'contract' is distinct from 'member-capture@1'
  or p_roster->>'tenantId' is distinct from p_tenant::text
  or (p_roster#>>'{period,start}')::timestamptz is distinct from p_start or (p_roster#>>'{period,end}')::timestamptz is distinct from p_end
  or (p_roster->>'observedAt')::timestamptz is distinct from p_observed or jsonb_typeof(p_teams) is distinct from 'array' then
  raise exception 'Frozen ownership scope differs from calculation' using errcode='22023';end if;
 if jsonb_array_length(p_history->'events')>1000 or octet_length(p_roster::text)>2097152 or octet_length(p_teams::text)>2097152 then
  raise exception 'Frozen ownership exceeds calculation bound' using errcode='54000';end if;
 if p_history->>'sourceThrough' is not null and ((p_history->>'sourceThrough')::timestamptz<p_end or (p_history->>'sourceThrough')::timestamptz>p_observed) then
  raise exception 'Ownership capture does not cover the calculation observation' using errcode='22023';end if;
 period:=jsonb_build_object('start',p_start,'end',p_end);whole:=tstzmultirange(tstzrange(p_start,p_end,'[)'));
 for v in select x from (values(p_calendar),(p_delay)) as snapshots(x) loop
  if v->>'tenantId' is distinct from p_tenant::text or (v->>'observedAt')::timestamptz is distinct from p_observed
   or (v#>>'{period,start}')::timestamptz is distinct from p_start or (v#>>'{period,end}')::timestamptz is distinct from p_end then
   raise exception 'Working-time snapshot scope differs from calculation' using errcode='22023';end if;
 end loop;
 if p_calendar->>'contract' is distinct from 'work-calendar-snapshot@1'
  or jsonb_typeof(p_calendar->'complete') is distinct from 'boolean' or jsonb_typeof(p_calendar->'versions') is distinct from 'array'
  or p_delay->>'contract' is distinct from 'work-delay-snapshot@1' or p_delay->>'objectId' is distinct from object_id::text
  or jsonb_typeof(p_delay->'approvals') is distinct from 'array' or (p_delay->>'through')!~'^\d+$' or p_delay->>'through' is null then
  raise exception 'Invalid calendar or delay snapshot' using errcode='22023';end if;
 if jsonb_array_length(p_calendar->'versions')>100 or jsonb_array_length(p_delay->'approvals')>1000 then
  raise exception 'Working-time snapshot exceeds review bound' using errcode='54000';end if;
 calendar_ranges:=learn_working_time_ranges(p_calendar->'windows',p_start,p_end);
 calendar_coverage:=learn_working_time_ranges((select coalesce(jsonb_agg(jsonb_build_object('start',x->'start','end',x->'end')),'[]') from jsonb_array_elements(p_calendar->'versions') x),p_start,p_end);
 missing_ranges:=learn_working_time_ranges(p_calendar->'missing',p_start,p_end);
 calendar_complete:=(p_calendar->>'complete')::boolean;
 if missing_ranges is distinct from whole-calendar_coverage or calendar_complete is distinct from (missing_ranges='{}'::tstzmultirange)
  or calendar_ranges-calendar_coverage<>'{}'::tstzmultirange
  or (select coalesce(sum(extract(epoch from (x->>'end')::timestamptz-(x->>'start')::timestamptz)*1000000),0) from jsonb_array_elements(p_calendar->'versions') x)
   <>learn_working_time_micros(calendar_coverage)
  or (select count(distinct value->>'publicationId')<>count(*) from jsonb_array_elements(p_calendar->'versions')) then
  raise exception 'Calendar coverage is inconsistent' using errcode='22023';end if;
 for v in select value from jsonb_array_elements(p_calendar->'versions') loop
  if not(v ?& array['publicationId','versionId','revision','effectiveFrom','start','end','definition'])
   or v->>'revision' is null or v->>'effectiveFrom' is null or (v->>'publicationId')::uuid is null or (v->>'versionId')::uuid is null or (v->>'revision')::int<1
   or (v->>'effectiveFrom')::timestamptz>(v->>'start')::timestamptz or jsonb_typeof(v->'definition') is distinct from 'object' then
   raise exception 'Invalid retained calendar version' using errcode='22023';end if;
 end loop;
 delay_ranges:=learn_working_time_ranges(p_delay->'windows',p_start,p_end);
 if (select count(distinct value->>'id')<>count(*) or count(distinct value->>'revision')<>count(*) from jsonb_array_elements(p_delay->'approvals')) then
  raise exception 'Repeated delay approval' using errcode='22023';end if;
 for v in select value from jsonb_array_elements(p_delay->'approvals') loop
  if not(v ?& array['tenantId','objectId','decision','id','revision','recordedAt','period'])
   or v->>'revision' is null or v->>'recordedAt' is null or v#>>'{period,start}' is null or v#>>'{period,end}' is null
   or v->>'tenantId' is distinct from p_tenant::text or v->>'objectId' is distinct from object_id::text or v->>'decision' is distinct from 'approve'
   or (v->>'id')::uuid is null or (v->>'revision')::int not between 1 and (p_delay->>'through')::int
   or (v->>'recordedAt')::timestamptz>p_observed or (v#>>'{period,start}')::timestamptz>=(v#>>'{period,end}')::timestamptz
   or (v#>>'{period,end}')::timestamptz>(v->>'recordedAt')::timestamptz
   or (v#>>'{period,start}')::timestamptz>=p_end or (v#>>'{period,end}')::timestamptz<=p_start then
   raise exception 'Unrelated or invalid delay approval' using errcode='22023';end if;
 end loop;
 approval_ranges:=learn_working_time_ranges((select coalesce(jsonb_agg(jsonb_build_object('start',greatest(p_start,(x#>>'{period,start}')::timestamptz),
  'end',least(p_end,(x#>>'{period,end}')::timestamptz))),'[]') from jsonb_array_elements(p_delay->'approvals') x),p_start,p_end);
 if delay_ranges is distinct from approval_ranges then raise exception 'Delay windows differ from retained approvals' using errcode='22023';end if;
 base:=learn_work_collection_calculate(case p_kind when 'member' then 'residence' else 'teamResidence' end,
  p_subject,p_history,p_roster,p_teams,p_start,p_end,p_first_kind);
 eligible:=(base->>'eligible')::boolean;
 ownership_complete:=coalesce((base->>'complete')::boolean,false) and (not eligible or p_history->>'sourceThrough' is not null);
 for segment in select value from jsonb_array_elements(base->'credited') loop
  span:=learn_working_time_ranges(jsonb_build_array(jsonb_build_object('start',segment->'start','end',segment->'end')),p_start,p_end);
  raw_micros:=raw_micros+learn_working_time_micros(span);owned:=owned+span;
  is_selected:=states ? (segment->>'status');
  business:='{}';excluded:='{}';assessed:='{}';
  if is_selected then
   selected_owned:=selected_owned+span;business:=span*calendar_ranges;excluded:=business*delay_ranges;assessed:=business-delay_ranges;
   all_business:=all_business+business;all_excluded:=all_excluded+excluded;all_assessed:=all_assessed+assessed;
  end if;
  segments:=segments||jsonb_build_array(jsonb_build_object('ownership',segment,'selectedState',is_selected,
   'calendarWindows',learn_working_time_windows(business),'excludedWindows',learn_working_time_windows(excluded),'assessedWindows',learn_working_time_windows(assessed)));
 end loop;
 owned_micros:=learn_working_time_micros(owned);selected_micros:=learn_working_time_micros(selected_owned);
 business_micros:=learn_working_time_micros(all_business);excluded_micros:=learn_working_time_micros(all_excluded);assessed_micros:=learn_working_time_micros(all_assessed);
 if owned_micros<>raw_micros or business_micros<>excluded_micros+assessed_micros then
  raise exception 'Working-time segments overlap or do not reconcile' using errcode='55000';end if;
 complete:=ownership_complete and (calendar_complete or not eligible);
 if not ownership_complete then reasons:=reasons||'"ownership_history_incomplete"'::jsonb;end if;
 if not calendar_complete and eligible then reasons:=reasons||'"calendar_history_incomplete"'::jsonb;end if;
 answer:=jsonb_build_object('contract','work-working-time-item@1','tenantId',p_tenant,'objectId',object_id,'subject',jsonb_build_object('kind',p_kind,'id',p_subject),
  'period',period,'observedAt',p_observed,'states',states,'eligible',eligible,'complete',complete,'reasons',reasons,
  'ownershipComplete',ownership_complete,'calendarComplete',calendar_complete,'unit','working_item_minutes',
  'elapsedOwnedMicros',trunc(owned_micros)::text,'selectedOwnedMicros',trunc(selected_micros)::text,
  'calendarMicros',trunc(business_micros)::text,'excludedMicros',trunc(excluded_micros)::text,'assessedMicros',trunc(assessed_micros)::text,
  'knownValue',round(assessed_micros/60000000,12),'value',case when complete then round(assessed_micros/60000000,12) end,
  'delayThrough',(p_delay->>'through')::int,'delayApprovalIds',(select coalesce(jsonb_agg(x->'id' order by (x->>'revision')::int),'[]') from jsonb_array_elements(p_delay->'approvals') x),
  'calendarPublicationIds',(select coalesce(jsonb_agg(x->'publicationId' order by (x->>'start')::timestamptz),'[]') from jsonb_array_elements(p_calendar->'versions') x),
  'eventIds',base->'eventIds','segments',segments);
 if octet_length(answer::text)>2097152 then raise exception 'Working-time item proof exceeds review bound' using errcode='54000';end if;
 return answer;
end $$;
revoke all on function public.learn_working_time_ranges(jsonb,timestamptz,timestamptz),
 public.learn_working_time_windows(tstzmultirange),public.learn_working_time_micros(tstzmultirange),
 public.learn_working_time_calculate(uuid,text,uuid,jsonb,jsonb,jsonb,timestamptz,timestamptz,timestamptz,text,jsonb,jsonb,jsonb)
 from public,anon,authenticated,service_role;

-- SOURCE supabase/migrations/20261101130000_learn_working_time_collection.sql
-- Add distinct working-time collection kinds without rewriting prior receipts.
alter table public.learn_work_collection_runs drop constraint learn_work_collection_runs_kind_check;
alter table public.learn_work_collection_runs add constraint learn_work_collection_runs_kind_check
 check(kind in ('handoffs','residence','teamResidence','workingTime','teamWorkingTime'));
alter table public.learn_work_collection_runs add constraint learn_work_collection_run_tenant unique(id,tenant_id);
alter table public.learn_work_collection_items add constraint learn_work_collection_item_scope unique(run_id,ordinal,tenant_id,object_id);
alter table public.learn_work_collection_items drop constraint learn_work_collection_items_result_check;
alter table public.learn_work_collection_items add constraint learn_work_collection_items_result_check check(result is null or octet_length(result::text)<=2097152);
create table public.learn_working_collection_runs (
 run_id uuid primary key,tenant_id uuid not null,calendar jsonb not null,states jsonb not null,
 known_micros numeric not null default 0 check(known_micros>=0 and mod(known_micros,1)=0),
 foreign key(run_id,tenant_id) references public.learn_work_collection_runs(id,tenant_id),
 check(octet_length(calendar::text)<=2097152)
);
create table public.learn_working_collection_items (
 run_id uuid not null,ordinal bigint not null,tenant_id uuid not null,object_id uuid not null,
 delay_through integer not null check(delay_through>=0),history jsonb,delays jsonb,
 primary key(run_id,ordinal),
 foreign key(run_id,ordinal,tenant_id,object_id) references public.learn_work_collection_items(run_id,ordinal,tenant_id,object_id),
 check((history is null)=(delays is null)),
 check(history is null or octet_length(history::text)<=2097152),check(delays is null or octet_length(delays::text)<=2097152)
);
alter table public.learn_working_collection_runs enable row level security;
alter table public.learn_working_collection_items enable row level security;
revoke all on public.learn_working_collection_runs,public.learn_working_collection_items from public,anon,authenticated,service_role;
grant select on public.learn_working_collection_runs,public.learn_working_collection_items to authenticated;
create policy learn_working_collection_runs_read on public.learn_working_collection_runs for select to authenticated
 using(tenant_id=current_tenant_id() and coalesce(current_user_role(),'') in ('owner','admin'));
create policy learn_working_collection_items_read on public.learn_working_collection_items for select to authenticated
 using(tenant_id=current_tenant_id() and coalesce(current_user_role(),'') in ('owner','admin'));
create function public.learn_working_collection_immutable() returns trigger
language plpgsql set search_path=public,pg_temp as $$begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'Retained working-time evidence cannot be removed' using errcode='55000';end if;
 if not exists(select 1 from learn_work_collection_runs where id=old.run_id and state='collecting') then raise exception 'Completed working-time evidence cannot change' using errcode='55000';end if;
 if tg_table_name='learn_working_collection_runs' then
  if (to_jsonb(old)-'known_micros') is distinct from (to_jsonb(new)-'known_micros') or new.known_micros<old.known_micros then
   raise exception 'Frozen working-time inputs cannot change' using errcode='55000';end if;
 else
  if old.history is not null or new.history is null or new.delays is null or
   (to_jsonb(old)-array['history','delays']) is distinct from (to_jsonb(new)-array['history','delays']) then
   raise exception 'Frozen working-time item cannot change' using errcode='55000';end if;
 end if;return new;
end $$;
create trigger learn_working_collection_runs_immutable before update or delete on public.learn_working_collection_runs for each row execute function public.learn_working_collection_immutable();
create trigger learn_working_collection_runs_no_truncate before truncate on public.learn_working_collection_runs for each statement execute function public.learn_working_collection_immutable();
create trigger learn_working_collection_items_immutable before update or delete on public.learn_working_collection_items for each row execute function public.learn_working_collection_immutable();
create trigger learn_working_collection_items_no_truncate before truncate on public.learn_working_collection_items for each statement execute function public.learn_working_collection_immutable();
revoke all on function public.learn_working_collection_immutable() from public,anon,authenticated,service_role;

create function public.learn_working_rule_states(p_rule jsonb,p_kind text) returns jsonb
language plpgsql immutable set search_path=public,pg_temp as $$declare states jsonb;expected_kind text;expected_source text;begin
 if p_rule->>'key' not in ('work.working_item_minutes','work.team_working_item_minutes') then
  if p_rule ? 'workStates' then raise exception 'Work states apply only to working-time measures' using errcode='22023';end if;return null;
 end if;
 expected_kind:=case p_rule->>'key' when 'work.working_item_minutes' then 'member' else 'team' end;
 expected_source:=case expected_kind when 'member' then 'serviceos.work.working-time@1' else 'serviceos.work.team-working-time@1' end;
 states:=p_rule->'workStates';
 if p_kind is distinct from expected_kind or p_rule->>'unit' is distinct from 'working_item_minutes'
  or not coalesce((p_rule->'sourceSystems') ? expected_source,false) or jsonb_typeof(states) is distinct from 'array' then
  raise exception 'Working-time measure requires matching scope, source, unit and explicit states' using errcode='22023';end if;
 if jsonb_array_length(states) not between 1 and 50 or exists(select 1 from jsonb_array_elements(states) s
  where jsonb_typeof(s) is distinct from 'string' or length(s#>>'{}') not between 1 and 200 or btrim(s#>>'{}') is distinct from s#>>'{}')
  or (select count(distinct value)<>count(*) from jsonb_array_elements(states)) then
  raise exception 'Choose unique explicit work states' using errcode='22023';end if;
 return (select jsonb_agg(value order by value) from jsonb_array_elements(states));
end $$;
revoke all on function public.learn_working_rule_states(jsonb,text) from public,anon,authenticated,service_role;
-- Validate the additional rule fields before preserving the existing save path.
do $patch$ declare d text;anchor text:=$a$    v_keys := array_append(v_keys,m->>'key');$a$;begin
 select pg_get_functiondef('public.learn_scorecard_save_draft(uuid,integer,jsonb,text)'::regprocedure) into d;
 if array_length(string_to_array(d,anchor),1) is distinct from 2 then raise exception 'Unexpected scorecard validation contract';end if;
 execute replace(d,anchor,$a$    perform learn_working_rule_states(m,v_kind);
$a$||anchor);
end $patch$;

-- Only caller-materialised publication rows are used. No later table reads can
-- leak a commit into the frozen calendar; expanded windows are retained verbatim.
create function public.learn_working_calendar_freeze(p_tenant uuid,p_start timestamptz,p_end timestamptz,p_observed timestamptz,p_rows jsonb)
returns jsonb language plpgsql immutable set search_path=public,pg_temp set timezone='UTC' as $$
declare r jsonb;next_row jsonb;a timestamptz;b timestamptz;versions jsonb:='[]';windows jsonb:='[]';i int;first_at timestamptz;begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>100 then raise exception 'Calendar publication history exceeds supported limit' using errcode='54000';end if;
 first_at:=(p_rows->0->>'effective_from')::timestamptz;
 for i in 0..jsonb_array_length(p_rows)-1 loop
  r:=p_rows->i;next_row:=p_rows->(i+1);
  if r->>'tenant_id' is distinct from p_tenant::text or (r->>'effective_from')::timestamptz>p_observed then raise exception 'Frozen calendar scope mismatch' using errcode='22023';end if;
  a:=greatest(p_start,(r->>'effective_from')::timestamptz);b:=least(p_end,coalesce((next_row->>'effective_from')::timestamptz,p_end));
  if a>=b then raise exception 'Frozen calendar publication ordering changed' using errcode='22023';end if;
  versions:=versions||jsonb_build_array(jsonb_build_object('publicationId',r->'id','versionId',r->'version_id','revision',r->'revision','definition',r->'definition',
   'effectiveFrom',r->'effective_from','start',a,'end',b,'recordedBy',r->'actor_id','reason',r->'reason'));
  windows:=windows||learn_work_calendar_expand(r->'definition',a,b);
 end loop;
 return jsonb_build_object('contract','work-calendar-snapshot@1','tenantId',p_tenant,'observedAt',p_observed,'period',jsonb_build_object('start',p_start,'end',p_end),
 'complete',coalesce(first_at<=p_start,false),'missing',case when first_at is null or first_at>p_start then jsonb_build_array(jsonb_build_object('start',p_start,'end',least(coalesce(first_at,p_end),p_end))) else '[]'::jsonb end,
 'versions',versions,'windows',windows);
end $$;
revoke all on function public.learn_working_calendar_freeze(uuid,timestamptz,timestamptz,timestamptz,jsonb) from public,anon,authenticated,service_role;
create function public.learn_working_delay_freeze(p_tenant uuid,p_object uuid,p_start timestamptz,p_end timestamptz,p_observed timestamptz,p_through integer)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$declare approvals jsonb;spans jsonb;n int;begin
 if p_through is null or p_through<0 or (p_through>0 and not exists(select 1 from learn_work_delay_events where tenant_id=p_tenant and object_id=p_object and revision=p_through and recorded_at<=p_observed)) then
  raise exception 'Frozen delay revision unavailable' using errcode='55000';end if;
 select count(*) into n from learn_work_delay_events a where a.tenant_id=p_tenant and a.object_id=p_object and a.revision<=p_through and a.decision='approve'
  and a.window_start<p_end and a.window_end>p_start and not exists(select 1 from learn_work_delay_events r where r.approval_id=a.id and r.revision<=p_through);
 if n>1000 then raise exception 'Frozen delay snapshot exceeds review limit' using errcode='54000';end if;
 select coalesce(jsonb_agg(learn_work_delay_entry(a) order by a.revision),'[]') into approvals from learn_work_delay_events a
  where a.tenant_id=p_tenant and a.object_id=p_object and a.revision<=p_through and a.decision='approve' and a.window_start<p_end and a.window_end>p_start
   and not exists(select 1 from learn_work_delay_events r where r.approval_id=a.id and r.revision<=p_through);
 select coalesce(jsonb_agg(jsonb_build_object('start',greatest(p_start,(v#>>'{period,start}')::timestamptz),'end',least(p_end,(v#>>'{period,end}')::timestamptz))),'[]') into spans from jsonb_array_elements(approvals) v;
 return jsonb_build_object('contract','work-delay-snapshot@1','tenantId',p_tenant,'objectId',p_object,'through',p_through,'observedAt',p_observed,
  'period',jsonb_build_object('start',p_start,'end',p_end),'approvals',approvals,'windows',learn_working_time_windows(learn_working_time_ranges(spans,p_start,p_end)));
end $$;
revoke all on function public.learn_working_delay_freeze(uuid,uuid,timestamptz,timestamptz,timestamptz,integer) from public,anon,authenticated,service_role;
create or replace function public.learn_work_collection_begin(p_tenant uuid,p_kind text,p_subject uuid,p_policy uuid,p_revision integer,
 p_start timestamptz,p_end timestamptz,p_request uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);descriptor jsonb;r learn_work_collection_runs%rowtype;
 pol jsonb;rule jsonb;sk text;mk text;src text;un text;n integer;
begin
 if p_kind is null or p_kind not in ('handoffs','residence','teamResidence','workingTime','teamWorkingTime') or p_subject is null or p_policy is null or p_request is null
  or p_revision is null or p_revision<1 or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_start>=p_end or p_end>statement_timestamp() or p_end-p_start>interval '366 days' or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
  raise exception 'Choose a supported collection, completed period and reason' using errcode='22023';end if;
 descriptor:=jsonb_build_object('contract','work-collection@1','kind',p_kind,'subjectId',p_subject,'policyId',p_policy,'policyVersion',p_revision,
  'start',p_start,'end',p_end,'reason',btrim(p_reason),'actorId',actor);
 perform pg_advisory_xact_lock(hashtextextended('learn-work-collect:'||p_request::text,0));
 select * into r from learn_work_collection_runs where id=p_request;
 if found then
  if r.tenant_id<>p_tenant or r.request is distinct from descriptor then raise exception 'Collection request identity changed' using errcode='PT409';end if;
  return learn_work_collection_result(r);
 end if;
 if exists(select 1 from measurements where id=p_request) or exists(select 1 from learn_work_measurement_runs where id=p_request)
  or exists(select 1 from learn_team_work_measurement_runs where id=p_request) then raise exception 'Request identity already used' using errcode='PT409';end if;
 sk:=case when p_kind in ('teamResidence','teamWorkingTime') then 'team' else 'member' end;
 mk:=case p_kind when 'handoffs' then 'work.recorded_handoffs' when 'residence' then 'work.owned_item_minutes' when 'workingTime' then 'work.working_item_minutes' when 'teamWorkingTime' then 'work.team_working_item_minutes' else 'work.team_owned_item_minutes' end;
 src:=case p_kind when 'handoffs' then 'serviceos.work.handoffs@1' when 'residence' then 'serviceos.work.residence@1' when 'workingTime' then 'serviceos.work.working-time@1' when 'teamWorkingTime' then 'serviceos.work.team-working-time@1' else 'serviceos.work.team-residence@1' end;
 un:=case p_kind when 'handoffs' then 'handoffs' when 'workingTime' then 'working_item_minutes' when 'teamWorkingTime' then 'working_item_minutes' else 'item_minutes' end;
 if sk='team' then perform 1 from org_units where id=p_subject and tenant_id=p_tenant for share;
 else perform 1 from team_members where id=p_subject and tenant_id=p_tenant for share;end if;
 if not found then raise exception 'Subject not in tenant' using errcode='22023';end if;
 select e.value into pol from operating_profile_entries e join config_versions c on c.id=e.version_id and c.tenant_id=e.tenant_id
  where e.tenant_id=p_tenant and e.namespace='learn_scorecards' and e.scope_kind='tenant' and e.key like 'definition.%'
  and e.value->>'id'=p_policy::text and e.value->>'version'=p_revision::text and c.artifact_kind='learn_scorecard'
  and c.version=p_revision and c.status in ('draft','published') for share of e,c;
 if pol is null or pol->>'subjectKind' is distinct from sk or
  (pol->>'groupId' is not null and (sk<>'team' or pol->>'groupId' is distinct from p_subject::text)) then
  raise exception 'Policy does not cover this subject' using errcode='22023';end if;
 select value into rule from jsonb_array_elements(pol->'metrics') where value->>'key'=mk;
 if rule is null or rule->>'unit' is distinct from un or not coalesce((rule->'sourceSystems') ? src,false) then
  raise exception 'Policy does not define this collection' using errcode='22023';end if;
 perform learn_working_rule_states(rule,sk);
 perform learn_work_collection_cell_lock(p_tenant,p_kind,p_subject,p_policy,p_revision,p_start,p_end);
 if exists(select 1 from measurements where tenant_id=p_tenant and subject_kind=sk and subject_id=p_subject and policy_id=p_policy
   and policy_revision=p_revision and metric_key=mk and window_start=p_start and window_end=p_end)
  or exists(select 1 from learn_work_collection_runs where tenant_id=p_tenant and kind=p_kind and subject_id=p_subject
   and policy_id=p_policy and policy_revision=p_revision and window_start=p_start and window_end=p_end and state='collecting') then
  raise exception 'An observation or collection already exists for this cell' using errcode='PT409';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.intelligence_objects'::regclass and tgname='learn_capture_work_change' and tgenabled in ('O','A')) then
  raise exception 'Work capture is unavailable' using errcode='55000';end if;
 -- One statement snapshot freezes membership, team directory, population and each
 -- work history head. UUID ordering is materialized, never re-queried on resume.
 with frozen as materialized (select learn_member_history_read(p_tenant,p_start,p_end) roster,
  (select coalesce(jsonb_agg(jsonb_build_object('id',id,'createdAt',created_at) order by id),'[]') from org_units where tenant_id=p_tenant) teams,
  case when p_kind in ('workingTime','teamWorkingTime') then learn_working_calendar_freeze(p_tenant,p_start,p_end,statement_timestamp(),
   (select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('definition',v.definition,'revision',v.revision) order by p.effective_from),'[]')
    from learn_work_calendar_publications p join learn_work_calendar_versions v on v.id=p.version_id and v.tenant_id=p.tenant_id
    where p.tenant_id=p_tenant and p.effective_from<p_end and p.effective_from<=statement_timestamp()
     and (p.effective_from>=p_start or p.id=(select id from learn_work_calendar_publications where tenant_id=p_tenant and effective_from<p_start order by effective_from desc limit 1)))) end calendar),
 inserted as (insert into learn_work_collection_runs(id,tenant_id,actor_id,request,kind,subject_kind,subject_id,policy_id,policy_revision,policy,
  window_start,window_end,reason,snapshot_at,roster,teams,source_system,metric_key,unit)
  select p_request,p_tenant,actor,descriptor,p_kind,sk,p_subject,p_policy,p_revision,pol,p_start,p_end,btrim(p_reason),statement_timestamp(),roster,teams,src,mk,un from frozen returning id),
 working as (insert into learn_working_collection_runs(run_id,tenant_id,calendar,states)
  select inserted.id,p_tenant,frozen.calendar,learn_working_rule_states(rule,sk) from inserted cross join frozen
  where p_kind in ('workingTime','teamWorkingTime') returning run_id),
 items as (insert into learn_work_collection_items(run_id,tenant_id,ordinal,object_id,head_sequence,head_reconciled,first_kind,first_at)
 select inserted.id,p_tenant,row_number() over(order by o.id),o.id,h.capture_sequence,
  (h.id is null or (h.work_after=learn_work_snapshot(o) and h.occurred_at<=statement_timestamp())),f.capture_kind,f.occurred_at
 from inserted cross join intelligence_objects o
 left join lateral (select id,capture_sequence,work_after,occurred_at from object_state_history where tenant_id=p_tenant and object_id=o.id and capture_kind is not null order by capture_sequence desc limit 1) h on true
 left join lateral (select capture_kind,occurred_at from object_state_history where tenant_id=p_tenant and object_id=o.id and capture_kind is not null order by capture_sequence limit 1) f on true
 where o.tenant_id=p_tenant returning run_id,ordinal,tenant_id,object_id)
 insert into learn_working_collection_items(run_id,ordinal,tenant_id,object_id,delay_through)
 select i.run_id,i.ordinal,i.tenant_id,i.object_id,coalesce((select max(revision) from learn_work_delay_events where tenant_id=p_tenant and object_id=i.object_id and recorded_at<=statement_timestamp()),0)
 from items i join working w on w.run_id=i.run_id;
 select count(*) into n from learn_work_collection_items where run_id=p_request;
 if exists(select 1 from learn_work_collection_items where run_id=p_request and not head_reconciled) then
  raise exception 'Current work state does not reconcile with captured history' using errcode='55000';end if;
 update learn_work_collection_runs set population=n where id=p_request returning * into r;
 perform learn_work_collection_access(p_tenant);
 return learn_work_collection_result(r);
end $$;

create or replace function public.learn_work_collection_step(p_tenant uuid,p_request uuid,p_after integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);r learn_work_collection_runs%rowtype;i learn_work_collection_items%rowtype;
 item_result jsonb;ctx learn_working_collection_runs%rowtype;ic learn_working_collection_items%rowtype;frozen_history jsonb;frozen_delays jsonb;is_working boolean;pol jsonb;value numeric;payload jsonb;ack jsonb;begin
 select * into r from learn_work_collection_runs where id=p_request and tenant_id=p_tenant for update;
 if not found or r.actor_id<>actor then raise exception 'Collection unavailable to this actor' using errcode='42501';end if;
 if p_after is null or p_after<0 or p_after>r.processed then raise exception 'Collection checkpoint changed' using errcode='PT409';end if;
 if r.state<>'collecting' or p_after<r.processed then return learn_work_collection_result(r);end if;
 is_working:=r.kind in ('workingTime','teamWorkingTime');
 if is_working then
  select * into ctx from learn_working_collection_runs where run_id=r.id and tenant_id=r.tenant_id for update;
  if not found then raise exception 'Frozen working-time inputs unavailable' using errcode='55000';end if;
 end if;
 for i in select * from learn_work_collection_items where run_id=p_request and ordinal>r.processed order by ordinal limit 100 loop
  if i.result is not null then raise exception 'Unexpected item checkpoint' using errcode='55000';end if;
  if is_working then
   select * into ic from learn_working_collection_items where run_id=r.id and ordinal=i.ordinal and tenant_id=r.tenant_id;
   if not found or ic.history is not null then raise exception 'Frozen working-time item unavailable' using errcode='55000';end if;
   frozen_history:=learn_work_collection_history(i,r.window_start,r.window_end,r.snapshot_at);
   frozen_delays:=learn_working_delay_freeze(r.tenant_id,i.object_id,r.window_start,r.window_end,r.snapshot_at,ic.delay_through);
   item_result:=learn_working_time_calculate(r.tenant_id,r.subject_kind,r.subject_id,frozen_history,r.roster,r.teams,r.window_start,r.window_end,r.snapshot_at,i.first_kind,ctx.states,ctx.calendar,frozen_delays);
   update learn_working_collection_items set history=frozen_history,delays=frozen_delays where run_id=r.id and ordinal=i.ordinal;
   ctx.known_micros:=ctx.known_micros+(item_result->>'assessedMicros')::numeric;
  else
   item_result:=learn_work_collection_calculate(r.kind,r.subject_id,learn_work_collection_history(i,r.window_start,r.window_end,r.snapshot_at),r.roster,r.teams,r.window_start,r.window_end,i.first_kind);
  end if;
  update learn_work_collection_items set result=item_result where run_id=i.run_id and ordinal=i.ordinal;
  r.processed:=r.processed+1;
  if (item_result->>'eligible')::boolean then
   r.eligible:=r.eligible+1;
   if (item_result->>'complete')::boolean then r.covered:=r.covered+1;end if;
   r.known_value:=r.known_value+(item_result->>'knownValue')::numeric;
  end if;
 end loop;
 if is_working then
  update learn_working_collection_runs set known_micros=ctx.known_micros where run_id=r.id;
  r.known_value:=round(ctx.known_micros/60000000,12);
 end if;
 if r.processed=r.population then
  perform learn_work_collection_cell_lock(r.tenant_id,r.kind,r.subject_id,r.policy_id,r.policy_revision,r.window_start,r.window_end);
  if exists(select 1 from measurements where tenant_id=p_tenant and subject_kind=r.subject_kind and subject_id=r.subject_id
    and policy_id=r.policy_id and policy_revision=r.policy_revision and metric_key=r.metric_key and window_start=r.window_start and window_end=r.window_end) then
   r.state:='superseded';r.end_reason:='Another observation already exists for this cell. Review it before collecting again.';
  else
   select e.value into pol from operating_profile_entries e join config_versions c on c.id=e.version_id and c.tenant_id=e.tenant_id
    where e.tenant_id=p_tenant and e.namespace='learn_scorecards' and e.scope_kind='tenant' and e.key like 'definition.%'
    and e.value->>'id'=r.policy_id::text and e.value->>'version'=r.policy_revision::text and c.artifact_kind='learn_scorecard'
    and c.version=r.policy_revision and c.status in ('draft','published') for share of e,c;
   if pol is distinct from r.policy then
    r.state:='superseded';r.end_reason:='Scoring rules changed during collection. Start a new collection for the saved rules.';
   else
    r.state:='completed';r.observed_at:=clock_timestamp();value:=case when r.covered=r.eligible and (not is_working or (ctx.calendar->>'complete')::boolean) then r.known_value end;
    r.explanation:='Frozen retained-work collection processed in batches. '||r.covered||' of '||r.eligible||' eligible items have complete history and identity coverage. '
     ||case when r.kind='handoffs' then 'Counts captured outgoing transfers; member/user aliases are not extra transfers. ' else 'Counts elapsed owned item-minutes including waiting and closed states; simultaneous items add separately. ' end
     ||'This is not working hours, speed or productivity. No business calendar or delay exclusion applied. '
     ||case when value is null then 'Value withheld because coverage is incomplete.' else 'Human review remains required.' end;
    r.proof:=jsonb_build_object('contract','work-collection@1','kind',r.kind,'runId',r.id,'snapshotAt',r.snapshot_at,'population','all retained intelligence objects at snapshot',
     'populationCount',r.population,'processed',r.processed,'eligibleItems',r.eligible,'coveredItems',r.covered,'knownValue',r.known_value,'value',value,
     'itemsTable','learn_work_collection_items','itemCount',r.population,'membershipStored',true,'teamDirectoryStored',true);
    if is_working then
     r.explanation:='Frozen working-time collection: selected owned work states intersect published company hours, minus approved per-item delays. Concurrent items add separately. This is not hours worked, productivity or a pay decision. '
      ||case when value is null then 'Value withheld because calendar or ownership coverage is incomplete.' else 'Human review remains required.' end;
     r.proof:=r.proof||jsonb_build_object('calculation','work-working-time-item@1','states',ctx.states,'calendarComplete',ctx.calendar->'complete',
      'assessedMicros',trunc(ctx.known_micros)::text,'workingInputsTable','learn_working_collection_runs','workingItemsTable','learn_working_collection_items');
    end if;
   end if;
  end if;
 end if;
 perform learn_work_collection_access(p_tenant);
 update learn_work_collection_runs set processed=r.processed,eligible=r.eligible,covered=r.covered,known_value=r.known_value,
  state=r.state,observed_at=r.observed_at,explanation=r.explanation,proof=r.proof,end_reason=r.end_reason where id=p_request;
 if r.state='completed' then
  payload:=jsonb_build_object('id',r.id,'tenantId',p_tenant,'subject',jsonb_build_object('kind',r.subject_kind,'id',r.subject_id),
   'metricKey',r.metric_key,'policyId',r.policy_id,'policyVersion',r.policy_revision,'period',jsonb_build_object('start',r.window_start,'end',r.window_end),
   'value',value,'unit',r.unit,'sampleCount',r.covered,'coveredCount',r.covered,'eligibleCount',r.eligible,'observedAt',r.observed_at,
   'sourceThrough',case when r.covered=r.eligible and (not is_working or value is not null) then r.snapshot_at end,'sourceSystem',r.source_system,'review','inferred',
   'evidence',jsonb_build_array(jsonb_build_object('table','learn_work_collection_runs','id',r.id)),'exclusions','[]'::jsonb);
  ack:=learn_performance_append(p_tenant,payload,r.reason);
 end if;
 return learn_work_collection_result(r);
end $$;

create or replace function public.learn_work_collection_abandon(p_tenant uuid,p_kind text,p_subject uuid,p_policy uuid,p_revision integer,
 p_start timestamptz,p_end timestamptz,p_request uuid,p_reason text,p_end_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);r learn_work_collection_runs%rowtype;descriptor jsonb;begin
 if p_kind is null or p_kind not in ('handoffs','residence','teamResidence','workingTime','teamWorkingTime') or p_subject is null or p_policy is null or p_request is null
  or p_revision is null or p_revision<1 or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_start>=p_end or p_end>statement_timestamp() or p_end-p_start>interval '366 days'
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or length(btrim(coalesce(p_end_reason,''))) not between 1 and 1000 then
  raise exception 'An exact collection request and ending reason are required' using errcode='22023';end if;
 descriptor:=jsonb_build_object('contract','work-collection@1','kind',p_kind,'subjectId',p_subject,'policyId',p_policy,'policyVersion',p_revision,
  'start',p_start,'end',p_end,'reason',btrim(p_reason),'actorId',actor);
 perform pg_advisory_xact_lock(hashtextextended('learn-work-collect:'||p_request::text,0));
 select * into r from learn_work_collection_runs where id=p_request for update;
 if found then
  if r.tenant_id<>p_tenant or r.actor_id<>actor or r.request is distinct from descriptor then raise exception 'Collection request identity changed' using errcode='PT409';end if;
  if r.state='collecting' then
   update learn_work_collection_runs set state='abandoned',end_reason=btrim(p_end_reason) where id=p_request returning * into r;
  elsif r.state='abandoned' and r.end_reason is distinct from btrim(p_end_reason) then
   raise exception 'Collection ending reason already recorded' using errcode='PT409';end if;
 else
  if exists(select 1 from measurements where id=p_request) or exists(select 1 from learn_work_measurement_runs where id=p_request)
   or exists(select 1 from learn_team_work_measurement_runs where id=p_request) then raise exception 'Request identity already used' using errcode='PT409';end if;
  insert into learn_work_collection_runs(id,tenant_id,actor_id,request,kind,subject_kind,subject_id,policy_id,policy_revision,policy,
   window_start,window_end,reason,snapshot_at,roster,teams,source_system,metric_key,unit,state,end_reason)
  values(p_request,p_tenant,actor,descriptor,p_kind,case when p_kind in ('teamResidence','teamWorkingTime') then 'team' else 'member' end,p_subject,p_policy,p_revision,'{}',
   p_start,p_end,btrim(p_reason),statement_timestamp(),'{}','[]',
   case p_kind when 'handoffs' then 'serviceos.work.handoffs@1' when 'residence' then 'serviceos.work.residence@1' when 'workingTime' then 'serviceos.work.working-time@1' when 'teamWorkingTime' then 'serviceos.work.team-working-time@1' else 'serviceos.work.team-residence@1' end,
   case p_kind when 'handoffs' then 'work.recorded_handoffs' when 'residence' then 'work.owned_item_minutes' when 'workingTime' then 'work.working_item_minutes' when 'teamWorkingTime' then 'work.team_working_item_minutes' else 'work.team_owned_item_minutes' end,
   case p_kind when 'handoffs' then 'handoffs' when 'workingTime' then 'working_item_minutes' when 'teamWorkingTime' then 'working_item_minutes' else 'item_minutes' end,'abandoned',btrim(p_end_reason)) returning * into r;
 end if;
 perform learn_work_collection_access(p_tenant);
 return learn_work_collection_result(r);
end $$;

create or replace function public.learn_work_collection_evidence(p_tenant uuid,p_request uuid,p_part text,p_after bigint default 0) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);r learn_work_collection_runs%rowtype;i learn_work_collection_items%rowtype;
 rows jsonb:='[]';working_input learn_working_collection_items%rowtype;entry jsonb;bytes integer:=0;last_ordinal bigint:=p_after;begin
 select * into r from learn_work_collection_runs where tenant_id=p_tenant and id=p_request;
 if not found or r.state<>'completed' then raise exception 'Completed collection evidence unavailable' using errcode='42501';end if;
 if p_part in ('calendar','workingItem') and r.kind in ('workingTime','teamWorkingTime') then
  if p_after is null or (p_part='calendar' and p_after<>0) or (p_part='workingItem' and (p_after<1 or p_after>r.population)) then raise exception 'Invalid working-time proof page' using errcode='22023';end if;
  if p_part='calendar' then
   select jsonb_build_object('calendar',calendar,'states',states,'assessedMicros',trunc(known_micros)::text) into entry from learn_working_collection_runs where run_id=r.id and tenant_id=r.tenant_id;
  else
   select * into working_input from learn_working_collection_items where run_id=r.id and ordinal=p_after and tenant_id=r.tenant_id;
   if not found or working_input.history is null then raise exception 'Retained working-time item unavailable' using errcode='55000';end if;
   entry:=jsonb_build_object('ordinal',working_input.ordinal,'objectId',working_input.object_id,'delayThrough',working_input.delay_through,'history',working_input.history,'delays',working_input.delays);
  end if;
  if entry is null then raise exception 'Retained working-time inputs unavailable' using errcode='55000';end if;
  return jsonb_build_object('contract','work-collection-evidence@1','runId',r.id,'tenantId',r.tenant_id,'part',p_part,'snapshotAt',r.snapshot_at,'data',entry);
 end if;
 if p_part is null or p_part not in ('overview','membership','teams','items') or p_after is null or p_after<0 or p_after>r.population or (p_part<>'items' and p_after<>0) then
  raise exception 'Invalid evidence page' using errcode='22023';end if;
 if p_part='overview' then return jsonb_build_object('contract','work-collection-evidence@1','runId',r.id,'tenantId',r.tenant_id,'part',p_part,
  'sourceSystem',r.source_system,'metricKey',r.metric_key,'observedAt',r.observed_at,'explanation',r.explanation,'proof',r.proof,
  'policy',r.policy,'subject',jsonb_build_object('kind',r.subject_kind,'id',r.subject_id),'period',jsonb_build_object('start',r.window_start,'end',r.window_end));end if;
 if p_part in ('membership','teams') then return jsonb_build_object('contract','work-collection-evidence@1','runId',r.id,'tenantId',r.tenant_id,'part',p_part,
  'snapshotAt',r.snapshot_at,'data',case p_part when 'membership' then r.roster else r.teams end);end if;
 for i in select * from learn_work_collection_items where run_id=p_request and ordinal>p_after order by ordinal limit 100 loop
  if i.result is null or i.ordinal<>last_ordinal+1 then raise exception 'Retained proof is incomplete' using errcode='55000';end if;
  entry:=(to_jsonb(i)-array['run_id','tenant_id'])||jsonb_build_object('head_sequence',i.head_sequence::text);
  if bytes+octet_length(entry::text)>2097152 and last_ordinal>p_after then exit;end if;
  bytes:=bytes+octet_length(entry::text);rows:=rows||jsonb_build_array(entry);last_ordinal:=i.ordinal;
 end loop;
 if p_after<r.population and last_ordinal=p_after then raise exception 'Retained proof is incomplete' using errcode='55000';end if;
 return jsonb_build_object('contract','work-collection-evidence@1','runId',r.id,'tenantId',r.tenant_id,'part',p_part,
  'population',r.population,'after',p_after,'next',case when last_ordinal<r.population then last_ordinal end,'items',rows);
end $$;

-- SOURCE supabase/migrations/20261101140000_learn_working_collection_input_bounds.sql
-- Refuse oversized retained inputs explicitly before an item/context write.
-- A failed batch rolls back atomically and keeps the original recovery request.
do $patch$ declare d text;anchor text:=$a$   item_result:=learn_working_time_calculate($a$;begin
 select pg_get_functiondef('public.learn_work_collection_step(uuid,uuid,integer)'::regprocedure) into d;
 if array_length(string_to_array(d,anchor),1) is distinct from 2 then raise exception 'Unexpected working-time step contract';end if;
 execute replace(d,anchor,$a$   if octet_length(frozen_history::text)>2097152 or octet_length(frozen_delays::text)>2097152 then
    raise exception 'Individual working-time history exceeds retained evidence limit' using errcode='54000';
   end if;
$a$||anchor);
end $patch$;

-- SOURCE supabase/migrations/20261101160000_learn_measurement_receipt_guards.sql
-- Validate retained work receipts at transaction completion. Numerical correction
-- RPCs append the measurement before their separate correction ledger in the same
-- transaction; deferred constraints verify the completed atomic write.
-- Existing observations, assessments and function definitions are unchanged.
create function public.learn_work_measurement_receipt_check(p_tenant uuid,p_id uuid)
returns void language plpgsql stable security definer set search_path=pg_catalog as $$
declare m public.measurements%rowtype; parent public.measurements%rowtype;
 c public.learn_performance_corrections%rowtype; original_observed timestamptz;
 visited uuid[]:='{}'; source_kind text; subject_kind text; metric text; unit_name text;
 receipt_table text; receipt jsonb; proof jsonb; request jsonb; expected_contract text;
begin
 select * into m from public.measurements where id=p_id and tenant_id=p_tenant;
 if not found then raise exception 'Measurement unavailable for receipt validation' using errcode='22023';end if;
 if coalesce(m.source,'') not in ('serviceos.work.handoffs@1','serviceos.work.residence@1','serviceos.work.team-residence@1',
   'serviceos.work.working-time@1','serviceos.work.team-working-time@1') and not exists(
   select 1 from jsonb_array_elements(case when jsonb_typeof(m.evidence)='array' then m.evidence else '[]' end) e where e->>'table' in
    ('learn_work_measurement_runs','learn_team_work_measurement_runs','learn_work_collection_runs')) then return;end if;
 while m.request_payload ? 'manualCorrectionId' loop
  if m.id=any(visited) or cardinality(visited)>=500 then
   raise exception 'Correction ancestry exceeds receipt validation bounds' using errcode='22023';end if;
  visited:=array_append(visited,m.id);
  select * into c from public.learn_performance_corrections where id=m.id and tenant_id=p_tenant;
  if not found or m.request_payload->>'manualCorrectionId' is distinct from m.id::text
   or c.predecessor_id is distinct from m.supersedes or c.corrected_value is distinct from m.value
   or c.created_at is distinct from m.measured_at or (original_observed is not null and original_observed<>c.source_observed_at) then
   raise exception 'Work correction has no matching retained provenance' using errcode='22023';end if;
  original_observed:=c.source_observed_at;
  select * into parent from public.measurements where id=c.predecessor_id and tenant_id=p_tenant;
  if not found or parent.value is distinct from c.previous_value or parent.measured_at>=m.measured_at
   or row(m.subject_kind,m.subject_id,m.policy_id,m.policy_revision,m.metric_key,m.unit,m.window_start,m.window_end,m.source,m.source_through,m.sample_count,m.covered_count,m.eligible_count,m.evidence,m.exclusions,m.group_ids)
     is distinct from row(parent.subject_kind,parent.subject_id,parent.policy_id,parent.policy_revision,parent.metric_key,parent.unit,parent.window_start,parent.window_end,parent.source,parent.source_through,parent.sample_count,parent.covered_count,parent.eligible_count,parent.evidence,parent.exclusions,parent.group_ids) then
   raise exception 'Work correction differs from its source scope' using errcode='22023';end if;
  m:=parent;
 end loop;
 if original_observed is not null and original_observed<>m.measured_at then
  raise exception 'Work correction changed original source time' using errcode='22023';end if;
 select v.kind,v.subject,v.metric,v.unit into source_kind,subject_kind,metric,unit_name from (values
 ('serviceos.work.handoffs@1','handoffs','member','work.recorded_handoffs','handoffs'),
 ('serviceos.work.residence@1','residence','member','work.owned_item_minutes','item_minutes'),
 ('serviceos.work.team-residence@1','teamResidence','team','work.team_owned_item_minutes','item_minutes'),
 ('serviceos.work.working-time@1','workingTime','member','work.working_item_minutes','working_item_minutes'),
 ('serviceos.work.team-working-time@1','teamWorkingTime','team','work.team_working_item_minutes','working_item_minutes')
 ) v(source,kind,subject,metric,unit) where v.source=m.source;
 if not found or m.subject_kind<>subject_kind or m.metric_key<>metric or m.unit<>unit_name
  or jsonb_typeof(m.evidence) is distinct from 'array' or jsonb_array_length(m.evidence)<>1
  or m.exclusions is distinct from '[]'::jsonb or m.eligible_count is null
  or m.sample_count is distinct from m.covered_count or m.covered_count<0 or m.covered_count>m.eligible_count
  or (m.value is not null and m.covered_count<>m.eligible_count) then
  raise exception 'Work measurement scope or coverage is unsupported' using errcode='22023';end if;
 receipt_table:=m.evidence#>>'{0,table}';
 if m.evidence#>>'{0,id}' is distinct from m.id::text or receipt_table is null or receipt_table not in
   ('learn_work_measurement_runs','learn_team_work_measurement_runs','learn_work_collection_runs')
  or (receipt_table<>'learn_work_collection_runs' and (source_kind in ('workingTime','teamWorkingTime')
   or receipt_table<>case when subject_kind='team' then 'learn_team_work_measurement_runs' else 'learn_work_measurement_runs' end)) then
  raise exception 'Work measurement has no original calculation reference' using errcode='22023';end if;
 -- The table identifier is selected exclusively from the allowlist above.
 execute format('select to_jsonb(r) from public.%I r where id=$1 and tenant_id=$2',receipt_table) into receipt using m.id,p_tenant;
 if receipt is null then raise exception 'Original work calculation is unavailable' using errcode='22023';end if;
 proof:=receipt->'proof';request:=receipt->'request';
 if receipt->>'source_system' is distinct from m.source or receipt->>'metric_key' is distinct from m.metric_key
  or (receipt->>'observed_at')::timestamptz is distinct from m.measured_at
  or proof->'value' is distinct from coalesce(to_jsonb(m.value),'null'::jsonb)
  or proof->'coveredItems' is distinct from to_jsonb(m.covered_count)
  or proof->'eligibleItems' is distinct from to_jsonb(m.eligible_count) then
  raise exception 'Work receipt summary differs from its measurement' using errcode='22023';end if;
 if receipt_table='learn_work_collection_runs' then
  if receipt->>'state' is distinct from 'completed' or receipt->>'kind' is distinct from source_kind
   or receipt->>'subject_kind' is distinct from m.subject_kind or (receipt->>'subject_id')::uuid is distinct from m.subject_id
   or (receipt->>'policy_id')::uuid is distinct from m.policy_id or (receipt->>'policy_revision')::integer is distinct from m.policy_revision
   or receipt->>'unit' is distinct from m.unit or (receipt->>'window_start')::timestamptz is distinct from m.window_start
   or (receipt->>'window_end')::timestamptz is distinct from m.window_end
   or proof->>'contract' is distinct from 'work-collection@1' or proof->>'kind' is distinct from source_kind
   or proof->>'runId' is distinct from m.id::text or receipt->'population' is distinct from receipt->'processed'
   or proof->'populationCount' is distinct from receipt->'population' or proof->'processed' is distinct from receipt->'population'
   or proof->'itemCount' is distinct from receipt->'population' or (receipt->>'population')::bigint<m.eligible_count
   or (case when m.value is null then m.source_through is not null else m.source_through is distinct from (receipt->>'snapshot_at')::timestamptz end) then
   raise exception 'Completed work receipt attribution differs' using errcode='22023';end if;
 else
  expected_contract:=case source_kind when 'handoffs' then 'work-handoffs@1' when 'residence' then 'work-residence@1' else 'team-work-residence@1' end;
  if proof->>'contract' is distinct from expected_contract
   or (receipt->>case when subject_kind='team' then 'team_id' else 'member_id' end)::uuid is distinct from m.subject_id
   or (request->>case when subject_kind='team' then 'teamId' else 'memberId' end)::uuid is distinct from m.subject_id
   or (request->>'policyId')::uuid is distinct from m.policy_id or (request->>'policyVersion')::integer is distinct from m.policy_revision
   or (request->>'start')::timestamptz is distinct from m.window_start or (request->>'end')::timestamptz is distinct from m.window_end
   or (m.value is null and m.source_through is not null) then
   raise exception 'Original work receipt attribution differs' using errcode='22023';end if;
 end if;
end $$;
revoke all on function public.learn_work_measurement_receipt_check(uuid,uuid) from public,anon,authenticated,service_role;

create function public.learn_measurement_receipt_constraint() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform public.learn_work_measurement_receipt_check(new.tenant_id,new.id);
 return null;
end $$;
revoke all on function public.learn_measurement_receipt_constraint() from public,anon,authenticated,service_role;
create constraint trigger learn_measurement_receipt_guard after insert on public.measurements
 deferrable initially deferred for each row execute function public.learn_measurement_receipt_constraint();

create function public.learn_review_receipt_constraint() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 -- Disputing old evidence must remain possible even when its source is malformed.
 if new.decision='confirmed' then
  perform public.learn_work_measurement_receipt_check(new.tenant_id,new.measurement_id);
 end if;
 return null;
end $$;
revoke all on function public.learn_review_receipt_constraint() from public,anon,authenticated,service_role;
create constraint trigger learn_review_receipt_guard after insert on public.learn_performance_reviews
 deferrable initially deferred for each row execute function public.learn_review_receipt_constraint();

create function public.learn_assessment_receipt_constraint() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare item jsonb; stored jsonb; pair record;
begin
 for item in select value from jsonb_array_elements(new.snapshot->'measurements') loop
  select to_jsonb(m)||jsonb_build_object('correction_request_id',m.request_payload->>'manualCorrectionId') into stored
   from public.measurements m where id=(item->>'id')::uuid and tenant_id=new.tenant_id;
  if stored is null then raise exception 'Assessment measurement is unavailable' using errcode='22023';end if;
  for pair in select key,value from jsonb_each(item) loop
   if pair.value is distinct from stored->pair.key then
    raise exception 'Assessment snapshot differs from retained measurement' using errcode='22023';end if;
  end loop;
  perform public.learn_work_measurement_receipt_check(new.tenant_id,(item->>'id')::uuid);
 end loop;
 return null;
end $$;
revoke all on function public.learn_assessment_receipt_constraint() from public,anon,authenticated,service_role;
create constraint trigger learn_assessment_receipt_guard after insert on public.learn_assessments
 deferrable initially deferred for each row execute function public.learn_assessment_receipt_constraint();

-- SOURCE supabase/migrations/20261101170000_learn_correction_recovery.sql
-- Recover one exact numerical correction; cancellation and correction share a lock.

create table public.learn_correction_cancellations (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 recorded_by uuid not null references public.profiles(id),
 request jsonb not null check(jsonb_typeof(request)='object' and octet_length(request::text)<=10000),
 recorded_at timestamptz not null default clock_timestamp()
);
alter table public.learn_correction_cancellations enable row level security;
revoke all on public.learn_correction_cancellations from public,anon,authenticated,service_role;
create trigger learn_correction_cancellations_immutable before update or delete on public.learn_correction_cancellations for each row execute function public.objectives_append_only();
create trigger learn_correction_cancellations_no_truncate before truncate on public.learn_correction_cancellations for each statement execute function public.objectives_append_only();

create function public.learn_performance_correction_resolve(p_tenant uuid,p_measurement uuid,p_request uuid,p_expected_review_revision integer,p_value numeric,p_reason text,p_cancel boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor_tenant uuid;actor_role text; prior public.learn_performance_corrections%rowtype;
 cancelled public.learn_correction_cancellations%rowtype; wanted jsonb;
begin
 select p.tenant_id,p.role into actor_tenant,actor_role from public.profiles p where p.id=auth.uid() for share;
 if auth.uid() is null or actor_tenant is distinct from p_tenant or coalesce(actor_role,'') not in ('owner','admin')
 or exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'Company owner/admin access required outside preview' using errcode='42501';end if;
 if p_tenant is null or p_measurement is null or p_request is null or p_expected_review_revision is null
 or p_expected_review_revision<0 or p_expected_review_revision>=2147483647 or p_cancel is null
 or length(btrim(coalesce(p_reason,''))) not between 1 and 1000
 or (p_value is not null and (p_value::text in ('NaN','Infinity','-Infinity') or abs(p_value)>1.7976931348623157e308)) then
  raise exception 'An exact correction request and recovery action are required' using errcode='22023';end if;
 wanted:=jsonb_build_object('measurement',p_measurement,'reviewRevision',p_expected_review_revision,'value',p_value,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-performance-correction:'||p_request::text,0));
 select * into prior from public.learn_performance_corrections where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.predecessor_id<>p_measurement or prior.corrected_by<>auth.uid()
   or prior.expected_review_revision<>p_expected_review_revision or prior.corrected_value is distinct from p_value or prior.reason<>btrim(p_reason) then
   raise exception 'Correction request identity changed' using errcode='PT409';end if;
  return jsonb_build_object('state','recorded','tenantId',p_tenant,'actorId',auth.uid(),'measurementId',p_request,'predecessorId',p_measurement,'recordedAt',prior.created_at);
 end if;
 select * into cancelled from public.learn_correction_cancellations where id=p_request;
 if found then
  if cancelled.tenant_id<>p_tenant or cancelled.recorded_by<>auth.uid() or cancelled.request is distinct from wanted then
   raise exception 'Correction request identity changed' using errcode='PT409';end if;
  return jsonb_build_object('state','cancelled','tenantId',p_tenant,'actorId',auth.uid(),'measurementId',p_request,'predecessorId',p_measurement);
 end if;
 -- Do not confirm, correct or delete the predecessor when checking/cancelling.
 -- A stale review or superseded predecessor can still have its pending intent retired.
 perform 1 from public.measurements where id=p_measurement and tenant_id=p_tenant and subject_kind<>'tenant' and request_payload is not null;
 if not found then raise exception 'Performance observation unavailable' using errcode='22023';end if;
 if p_cancel then
  insert into public.learn_correction_cancellations(id,tenant_id,recorded_by,request) values(p_request,p_tenant,auth.uid(),wanted);
 end if;
 return jsonb_build_object('state',case when p_cancel then 'cancelled' else 'pending' end,'tenantId',p_tenant,'actorId',auth.uid(),'measurementId',p_request,'predecessorId',p_measurement);
end $$;
revoke all on function public.learn_performance_correction_resolve(uuid,uuid,uuid,integer,numeric,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.learn_performance_correction_resolve(uuid,uuid,uuid,integer,numeric,text,boolean) to authenticated;

-- Preserve the existing correction function identity, source calculation and ACL.
do $patch$
declare definition text; anchor text:=$anchor$ select * into parent from public.measurements where id=p_measurement and tenant_id=p_tenant for update;$anchor$;
begin
 definition:=pg_get_functiondef('public.learn_performance_correct(uuid,uuid,uuid,integer,numeric,text)'::regprocedure);
 if length(definition)-length(replace(definition,anchor,''))<>length(anchor)
 or position('learn_correction_cancellations' in definition)>0
 or position('learn-performance-correction:' in definition)=0 then
  raise exception 'Unexpected correction definition; recovery patch not applied';end if;
 execute replace(definition,anchor,$replacement$ if exists(select 1 from public.learn_correction_cancellations where id=p_request) then
  raise exception 'Correction request cancelled; review evidence before a new correction' using errcode='PT409';end if;
$replacement$||anchor);
end $patch$;

insert into of_learn_deploy.migrations values('learn_scoring_working_time_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
