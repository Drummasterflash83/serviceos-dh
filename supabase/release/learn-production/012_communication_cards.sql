-- DRAFT: requires matched cards workers and explicit production approval.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;actual_views jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production Cards target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_phone_capture_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='f45c032695071204e9854a30b6b5a74f18e3ed2ddab2f690e86ae90157f429dc') then raise exception 'Pinned production Phone prerequisite missing';end if;
 if exists(select 1 from pg_roles where rolname='learn_card_communication_reader') or exists(select 1 from of_learn_deploy.migrations where migration_name='learn_cards_delivery_v1')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['learn_identity_delivery_receipts','learn_interaction_projection_receipts','learn_projection_operator_reviews','learn_identity_operator_reviews','learn_processing_publications','learn_processing_settlements']))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['learn_card_communications_read','learn_card_source_read','learn_card_search','learn_identity_revision','learn_identity_pending','learn_identity_deliver','learn_phone_source_fields','learn_email_source_fields','learn_projection_revision','learn_projection_pending','learn_project_interaction','learn_projection_review_count','learn_projection_review_state','learn_operator_projection_reviews','learn_operator_projection_review_detail','learn_operator_projection_review','learn_identity_deliver_internal','learn_identity_review_state','learn_operator_identity_reviews','learn_operator_identity_people','learn_operator_identity_review_detail','learn_operator_identity_review','learn_identity_review_count','learn_processing_publish','learn_processing_settle','learn_email_is_draft','learn_interaction_is_draft','learn_card_projection_inputs'])) then raise exception 'Production Cards candidate already exists; inspect before retry';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array['companies','customer_cards','email_messages','interaction_match_suggestions','interactions','jobs','org_units','people','phone_calls','phone_recordings','phone_sync_runs','platform_events','platform_jobs','profiles','recommendations','team_members','tenants']);
 if observed is distinct from '[{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"companies","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"domain","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"phone","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"address_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"postcode","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"verified","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"created_source","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"5432bdbc84f521fbeb2451145455865c","name":"companies_pkey","valid":true},{"hash":"fc269a5aba437e691699dc5e15eadfa4","name":"companies_tenant_domain_idx","valid":true},{"hash":"01e053c9a52440e526bdec9651204659","name":"companies_tenant_id_uk","valid":true},{"hash":"fb22c282bd61679b4b62d77c9a219662","name":"companies_tenant_idx","valid":true}],"forceRls":false,"policies":[{"name":"companies_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"291253580df21bff12714595b473a146","name":"companies_set_updated_at","enabled":"O"},{"hash":"780795e08f2f556db33bb7ab3e9af749","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"companies_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"customer_cards","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"title","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"summary","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d2e629d884dd34355a15552e5b518a5"},{"name":"priority","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"85d245f36de3b9cecc91228801a5247d"},{"name":"owner_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"due_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"latest_activity_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"recommended_action","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"context","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"assigned_team_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"watchers","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"followers","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"helper_suggestions","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"priority_score","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority_inputs","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"locked_fields","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"a353edc9afd9f0fc7e68f00793ab2cc4","name":"customer_cards_pkey","valid":true},{"hash":"3e66bfccc40049ca8a2bda1f99447e58","name":"customer_cards_tenant_activity_idx","valid":true},{"hash":"e6846f1fa5da9015a49bebc34efc5a0b","name":"customer_cards_tenant_company_idx","valid":true},{"hash":"5266765be7d2d1dbb11d350513b8d662","name":"customer_cards_tenant_person_idx","valid":true},{"hash":"0e7faa01b3e9d4f1ca7ff2b0b22a7762","name":"customer_cards_tenant_priority_idx","valid":true},{"hash":"c627136b94cf9123bfd3e965d14129e9","name":"customer_cards_tenant_score_idx","valid":true},{"hash":"8aec36a2a422bac4e872b104db4e8dc6","name":"customer_cards_tenant_status_idx","valid":true},{"hash":"d0286ddc9d5db787b2e0465dea1a1854","name":"learn_customer_card_company_uk","valid":true},{"hash":"1248c211117be2164f1e12318be31fdc","name":"learn_customer_card_person_uk","valid":true}],"forceRls":false,"policies":[{"name":"customer_cards_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"e9fe5f91503ebba1c507f9e0c30f4f4d","name":"customer_cards_set_updated_at","enabled":"O"},{"hash":"efe1e538d97c8e8cdd6f3def4ce9fb7f","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"c393f886f52b6010a512c5c0980ab536","kind":"f","name":"customer_cards_company_id_fkey","validated":true},{"hash":"bcfe24d956220872d4db2fac32db2f22","kind":"f","name":"customer_cards_person_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"customer_cards_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"email_messages","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"18d098a428c784185fe7bc34d1784903"},{"name":"provider_message_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"provider_thread_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"to_emails","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"cc_emails","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"subject","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"snippet","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"body_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"body_html","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"sent_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"received_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"direction","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"raw_payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"origin","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_delivery_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_automation_intent_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_campaign_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"origin_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"ddab13827db6fc862b347926210f2b5f","name":"email_messages_from_idx","valid":true},{"hash":"aa0806d4070a7b3212a80a84eb9c7d5c","name":"email_messages_pkey","valid":true},{"hash":"b6c142a1e1681434cb7a2e0292da277d","name":"email_messages_received_idx","valid":true},{"hash":"fe1c7bcc6524405f48f28a236599ee8e","name":"email_messages_tenant_id_idx","valid":true},{"hash":"ca8629c22d3dd310b1126f117b9b008b","name":"email_messages_tenant_id_provider_provider_message_id_key","valid":true},{"hash":"a2e59fd4b71cb47545b35622ff50fd81","name":"email_messages_thread_idx","valid":true}],"forceRls":false,"policies":[{"name":"email_messages_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"},{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"}],"triggers":[{"hash":"87e7af360d7a3fb98bcdea12d9105317","name":"email_messages_set_updated_at","enabled":"O"},{"hash":"f0031e3b13fd91945cc5615cee21adab","name":"learn_email_preserve_source_version","enabled":"O"}],"constraints":[{"hash":"b62110fa0a5753efbae5ef5b8caccc97","kind":"f","name":"email_messages_origin_campaign_fk","validated":true},{"hash":"1220af29a1985a4dabe03353bd48d8fe","kind":"c","name":"email_messages_origin_check","validated":true},{"hash":"a30c441924cbce62b8ad5027db53e1c5","kind":"f","name":"email_messages_origin_delivery_fk","validated":true},{"hash":"19a3d8f70792afd54bb9f0f14df3e6a6","kind":"f","name":"email_messages_origin_intent_fk","validated":true},{"hash":"e865d926f40b1e90e54c88f2d92a7bc1","kind":"f","name":"email_messages_origin_person_fk","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"email_messages_pkey","validated":true},{"hash":"7b594e8645b3085fdc803326bd97c4e4","kind":"u","name":"email_messages_tenant_id_provider_provider_message_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"interaction_match_suggestions","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"interaction_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"target_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"target_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"match_level","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"7e2561b9fef0e060424c6d2e7b17b6e1"},{"name":"confidence","type":"numeric(5,4)","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"explanation","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"recommended_action","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d0c12821e68f0fc31291c72ad568aa9"},{"name":"created_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"ed738e00cf61c2e4203aa040874c68c8","name":"ims_tenant_interaction_idx","valid":true},{"hash":"5bbf8d76775c6cd67a564405e8bf3ccf","name":"ims_tenant_level_idx","valid":true},{"hash":"bf2ef906ac9b7dbb54e72a96daa65aec","name":"ims_tenant_status_idx","valid":true},{"hash":"06a6d8f584741ec07ae90588f4111dbd","name":"interaction_match_suggestions_pkey","valid":true},{"hash":"a0c8ac88205b64878f3e2647cac4ff7e","name":"interaction_match_suggestions_tenant_id_interaction_id_targ_key","valid":true}],"forceRls":false,"policies":[{"name":"ims_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"442a08167bffcc4fb779c7e02f950acf","name":"ims_set_updated_at","enabled":"O"},{"hash":"4c16947bf66b72b4748957c519932af0","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"34dee01cf271d30066d465da386182fc","kind":"f","name":"interaction_match_suggestions_interaction_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"interaction_match_suggestions_pkey","validated":true},{"hash":"42eaa2c5bf3f1933196d01dc7f8165b9","kind":"u","name":"interaction_match_suggestions_tenant_id_interaction_id_targ_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"interactions","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_connector_id","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_table","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_external_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"interaction_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"direction","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"occurred_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"summary","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"body_preview","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_address","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"to_addresses","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"cc_addresses","type":"text[]","notNull":true,"identity":"","generated":"","defaultHash":"f81a5133416544064d5b9b182f73a6e1"},{"name":"phone_from","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"phone_to","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"processing_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d0c12821e68f0fc31291c72ad568aa9"},{"name":"sentiment","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_thread_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_job_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_task_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"source_updated_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source_version","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"related_campaign_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"386b7aa4a596d1f7a436f82ee5cd30d1","name":"interactions_pkey","valid":true},{"hash":"e9634fa8eca4b28f9d63657404df3fae","name":"interactions_related_campaign_idx","valid":true},{"hash":"8eaaf68213fe01dc3342f1135af48b37","name":"interactions_tenant_company_idx","valid":true},{"hash":"344e9c6e9a40d3f4cc5ffdd75d892e06","name":"interactions_tenant_connector_occurred_idx","valid":true},{"hash":"78eb70cc7e2fa21d550574b7d7fd2567","name":"interactions_tenant_id_source_table_source_id_key","valid":true},{"hash":"b872f2d916dee27b2d740a273b3a3a86","name":"interactions_tenant_occurred_idx","valid":true},{"hash":"9ab02b39c0a9dcb409371595dd22b317","name":"interactions_tenant_person_idx","valid":true},{"hash":"9026abb0805ac33730d78a21bdc85364","name":"interactions_tenant_processing_idx","valid":true},{"hash":"60847df577987b97a1aa8e49893f6740","name":"interactions_tenant_type_occurred_idx","valid":true},{"hash":"cfa31edad77dc169ce86ec6f0bb18c10","name":"interactions_tenant_type_source_idx","valid":true}],"forceRls":false,"policies":[{"name":"interactions_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"3b4c64fd9157e1dab30e91b351a56128","name":"interactions_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"interactions_pkey","validated":true},{"hash":"2e6cb81b96ef1f338484943fdb13da96","kind":"f","name":"interactions_related_campaign_fk","validated":true},{"hash":"2dc4fa1294c5cf8d6796d8b4c37f0fa0","kind":"u","name":"interactions_tenant_id_source_table_source_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"jobs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source_system","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"external_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_number","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"customer_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"customer_company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"site_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"engineer_person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"title","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"description","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_type","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"priority","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"invoice_status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"quote_status","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"value_pennies","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"booked_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"completed_date","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"active","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"b326b5062b2f0e69046810717534cb09"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ee37b3b19e0eb6a9ec843fb638bb846b"},{"name":"verified","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"e2b5d04060b50f96e02ff49b339ed40c","name":"jobs_number_uk","valid":true},{"hash":"47262421c727307ac344956cf7d14923","name":"jobs_pkey","valid":true},{"hash":"e34e04d2ff2d6c0312b227bd2c49508c","name":"jobs_source_uk","valid":true},{"hash":"cc280df5dbcf661faf07141d3eecca73","name":"jobs_tenant_customer_idx","valid":true},{"hash":"184a00fe1e8d9d8202141da43859208a","name":"jobs_tenant_idx","valid":true}],"forceRls":false,"policies":[{"name":"jobs_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"6531df5998769ed5ffb7779d6ce6dfbb","name":"jobs_set_updated_at","enabled":"O"},{"hash":"9e38c2eb0e81c9ead9a4527ff2bc657e","name":"learn_foundation_reference_guard","enabled":"O"}],"constraints":[{"hash":"08723955dee11c6cd8edfc8398afbaa0","kind":"f","name":"jobs_customer_company_id_fkey","validated":true},{"hash":"916bf00abad8f3f94f73abdcedf20f1d","kind":"f","name":"jobs_customer_person_id_fkey","validated":true},{"hash":"e51bea4de5e209d1bec8820944969827","kind":"f","name":"jobs_engineer_person_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"jobs_pkey","validated":true},{"hash":"d17aadc9a7f4da0432796d76a1939418","kind":"f","name":"jobs_site_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"org_units","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"kind","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"parent_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"977befb3251c01656fc9bf6c7d98e947","name":"org_units_id_tenant_uk","valid":true},{"hash":"89c7906b33ff47cfa0c22c491aa601bd","name":"org_units_pkey","valid":true},{"hash":"9ad08482ebb4aec4838a12c279cb7567","name":"org_units_tenant","valid":true}],"forceRls":false,"policies":[{"name":"org_units_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8ec7db638f9bc249e35a94914e7d05b4","permissive":"PERMISSIVE"}],"triggers":[{"hash":"05a71fc442922c364f5b8b415e6c80ec","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"dc2a972fad8ade815a16649ad7632e74","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"10515e6a015c6f4e3fe0ae000c44e665","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"d5cfd4d30554ccb75b30b8ef9a34e9d4","name":"org_units_set_updated_at","enabled":"O"}],"constraints":[{"hash":"d5fcca4b41cda0d74e531fcdd52cfa71","kind":"f","name":"org_units_parent_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"org_units_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"org_units_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"people","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"first_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"primary_email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"primary_phone","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"address_text","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"postcode","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"verified","type":"boolean","notNull":true,"identity":"","generated":"","defaultHash":"68934a3e9455fa72420237eb05902327"},{"name":"created_source","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"1a8b3beb83e2f08c9500a4a18238042d","name":"people_pkey","valid":true},{"hash":"1e2102652fc5b864ea0d57177355974f","name":"people_tenant_company_idx","valid":true},{"hash":"cb1a308c5d9e9b5215cd6c95b9457f38","name":"people_tenant_email_idx","valid":true},{"hash":"9b4fe18f0a581f205f2e61e3e4b38164","name":"people_tenant_id_uk","valid":true},{"hash":"fa3e7cb1191bafb9f0e8edd6a6f60434","name":"people_tenant_idx","valid":true},{"hash":"301186b8ad8b84b5970039e703cf0b60","name":"people_tenant_name_idx","valid":true},{"hash":"c8712f809e58386d8e5cc526441e3b9f","name":"people_tenant_phone_idx","valid":true}],"forceRls":false,"policies":[{"name":"people_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"a49717171f853266db7a99a56baaba1c","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"7dd86e31a8486f3dd2deddede5d2eded","name":"people_set_updated_at","enabled":"O"}],"constraints":[{"hash":"c393f886f52b6010a512c5c0980ab536","kind":"f","name":"people_company_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"people_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"phone_calls","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"8635fd7ef6f459e4bf239c48fc2077a6"},{"name":"provider_call_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"linked_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"direction","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"from_number","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"to_number","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"duration_seconds","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"outcome","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"cost","type":"numeric(12,4)","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"raw_payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"ad06f1828a4b92c109adb1f762c295e3","name":"phone_calls_feed_idx","valid":true},{"hash":"041a21ecbe4a029507ed2f7077d990ef","name":"phone_calls_from_number_idx","valid":true},{"hash":"ea8afbddb27a43baff209fb09069515d","name":"phone_calls_linked_id_idx","valid":true},{"hash":"aa6bc6fbd4a69f5048ec6912e1af7d76","name":"phone_calls_pkey","valid":true},{"hash":"07dd19ebb1744536c0e4fecc4ecd33e8","name":"phone_calls_started_at_idx","valid":true},{"hash":"1a4214891dce0f770f8c49b1a78faaf6","name":"phone_calls_tenant_id_idx","valid":true},{"hash":"8743c824e2d12b7edb49176233d498fa","name":"phone_calls_tenant_id_provider_provider_call_id_key","valid":true}],"forceRls":false,"policies":[{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"},{"name":"phone_calls_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"8f5a3046c7ffdc57f3903d1c00bf7231","name":"phone_calls_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"phone_calls_pkey","validated":true},{"hash":"93e9bfc0ac59cbc413c644fe7309a0ea","kind":"u","name":"phone_calls_tenant_id_provider_provider_call_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"phone_recordings","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"8635fd7ef6f459e4bf239c48fc2077a6"},{"name":"provider_recording_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"provider_call_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"linked_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"recording_uri","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"file_size","type":"bigint","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"duration_seconds","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"storage_path","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"raw_payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"e9b8cb4fa73612656b762a0dba9c2733","name":"phone_recordings_feed_idx","valid":true},{"hash":"984f7e1f561e0692b066ac1595709bbc","name":"phone_recordings_pkey","valid":true},{"hash":"72d3cb038f69fcae71277ac20c30881b","name":"phone_recordings_provider_call_id_idx","valid":true},{"hash":"79c1b0d656c6d1bb7be6450e453758dd","name":"phone_recordings_tenant_id_idx","valid":true},{"hash":"51f2ebc8c93acd85ebe42f2eac97d331","name":"phone_recordings_tenant_id_provider_provider_recording_id_key","valid":true}],"forceRls":false,"policies":[{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"},{"name":"phone_recordings_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"118396f378009025373f5159a2b2e09e","name":"phone_recordings_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"phone_recordings_pkey","validated":true},{"hash":"1264fb8f6704b74ca974958dc202fdaa","kind":"u","name":"phone_recordings_tenant_id_provider_provider_recording_id_key","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"phone_sync_runs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"provider","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"8635fd7ef6f459e4bf239c48fc2077a6"},{"name":"sync_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"412b424d07d3e1e0d1cf66fe0bdfee56"},{"name":"started_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"records_processed","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"error_message","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"}],"indexes":[{"hash":"366ab1eb33bd11ec5db7ec6d3c816e7c","name":"learn_phone_schedule_health_lookup","valid":true},{"hash":"c63f73917fafa3200b9740461fd906ef","name":"learn_phone_scheduler_latest_idx","valid":true},{"hash":"df5fe456f04f5fdb69dacebee30a1bd7","name":"phone_sync_runs_pkey","valid":true},{"hash":"9d5205da6633dbbc0fe7216948bbb399","name":"phone_sync_runs_recording_retry_idx","valid":true},{"hash":"d4f0b7f48936003ad3c6bc80857e2fdd","name":"phone_sync_runs_started_at_idx","valid":true},{"hash":"b757da236abfada2677cdece4ea2cb14","name":"phone_sync_runs_tenant_id_idx","valid":true},{"hash":"07982b684e927094313fef29c2197ea3","name":"phone_sync_runs_type_status_idx","valid":true}],"forceRls":false,"policies":[{"name":"learn_launch_metadata_select","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"1ce933c1a46da9acdab610e56565218b","permissive":"RESTRICTIVE"},{"name":"phone_sync_runs_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"phone_sync_runs_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"platform_events","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"event_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"subject_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"source","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"3d0c12821e68f0fc31291c72ad568aa9"},{"name":"attempts","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"published_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"consumed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"actor","type":"jsonb","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"occurred_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"domain","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"correlation_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"b492f6fbb2f09e1b0f0f0048d548841d","name":"platform_events_pending_subject_uk","valid":true},{"hash":"bc384965f69238d3fc29ecb7dcd53441","name":"platform_events_pkey","valid":true},{"hash":"542001a3bb43c8d86c0c3651a78b77bc","name":"platform_events_tenant_subject_idx","valid":true},{"hash":"eccb61d59f70f50973014ee590e1a674","name":"platform_events_tenant_type_status_idx","valid":true}],"forceRls":false,"policies":[{"name":"platform_events_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"9bf4a16275ca9fd32d48e04d21dcfb43","name":"platform_events_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"platform_events_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"platform_jobs","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"connector_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"module_id","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"job_type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"job_key","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"7c86ea6e5094355ad44b6867fa51b433"},{"name":"priority","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"f899139df5e1059396431415e770c6dd"},{"name":"progress_current","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"progress_total","type":"integer","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"records_processed","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"error_count","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"attempt_count","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"cfcd208495d565ef66e7dff9f98764da"},{"name":"max_attempts","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"eccbc87e4b5ce2fe28308fd9f2a7baf3"},{"name":"started_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"completed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"failed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"cancelled_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"next_run_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_error","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"payload","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"result","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"available_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"claimed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"claimed_by","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"lease_expires_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"last_attempt_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"dead_lettered_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"error_code","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"parent_job_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"e8ec53579fc23c9f8c7ec9cbcc9a0fe8","name":"platform_jobs_active_job_key_uk","valid":true},{"hash":"0c8ea2ecee43cf1b569083bac92b3889","name":"platform_jobs_claim_idx","valid":true},{"hash":"95f16cdddc29e798beb223f90905fec3","name":"platform_jobs_lease_idx","valid":true},{"hash":"a2be2946f7e3402dc0501da0f336f113","name":"platform_jobs_parent_idx","valid":true},{"hash":"f8699761f53393f77b94bc724a99e825","name":"platform_jobs_pkey","valid":true},{"hash":"95bfc00526e7f302fb99702339694c04","name":"platform_jobs_tenant_connector_idx","valid":true},{"hash":"1ed91a0d9b3bf296158e7c4558ce3189","name":"platform_jobs_tenant_next_run_idx","valid":true},{"hash":"a22868c903eedcb64e7366fb3249911f","name":"platform_jobs_tenant_status_idx","valid":true},{"hash":"a3359af1d6c9ed909e3b424d77e7a174","name":"platform_jobs_tenant_type_idx","valid":true}],"forceRls":false,"policies":[{"name":"platform_jobs_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"885bc7f92806b78eac67d45a9143c9ca","name":"platform_jobs_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"platform_jobs_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"profiles","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"tenant_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"email","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"full_name","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"role","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"ebe5151db32cb9795191097a4f9511a9"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"b7142bbffc23de763c1bd9f00489ec05","name":"profiles_pkey","valid":true},{"hash":"c07a523f1ebc968ab6b32bd5c984f32b","name":"profiles_role_idx","valid":true},{"hash":"610436088a5788625dd6956b9059f8c9","name":"profiles_tenant_id_idx","valid":true},{"hash":"84b975915f84814cf35c7604d4f94ecf","name":"profiles_tenant_id_uk","valid":true}],"forceRls":false,"policies":[{"name":"learn_launch_metadata_profile","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"PERMISSIVE"},{"name":"learn_launch_production_boundary","roles":["learn_launch_metadata_reader"],"command":"SELECT","checkHash":null,"usingHash":"15c587ac9e0e9db4618a46c0502f35aa","permissive":"RESTRICTIVE"},{"name":"profiles_select_own","roles":["public"],"command":"SELECT","checkHash":null,"usingHash":"bc9c729a84690340789a4e4f01175335","permissive":"PERMISSIVE"}],"triggers":[{"hash":"bb3752d7064fd9e06fbe457f475928cc","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"83b0936855bf3bb7daa4f8356eb3c926","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"8a97ecad600d272e906bb06dea0b91c4","name":"profiles_set_updated_at","enabled":"O"}],"constraints":[{"hash":"0061c9fb3a9abcf2edbcd4a42467a9c3","kind":"f","name":"profiles_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"profiles_pkey","validated":true},{"hash":"4b3bd90c7f38a26788aecebbe2479ad7","kind":"c","name":"profiles_role_check","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"recommendations","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"type","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"title","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"detail","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"severity","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"85d245f36de3b9cecc91228801a5247d"},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"af19994de25f269ffc07429c5874d89e"},{"name":"card_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"interaction_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"person_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"company_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"recommended_action","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"created_by","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"c08e9b72a1f5c2105a2649c074575a84"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"resolved_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"due_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"source_rule","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"impact","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null}],"indexes":[{"hash":"4c3b1a12b9481f060620e0e034d610d8","name":"recommendations_open_uk","valid":true},{"hash":"bde370f422c5bec8133c7bdfcfc5d4ad","name":"recommendations_pkey","valid":true},{"hash":"37fec77b72b8ed2b453fa492fff039e3","name":"recommendations_tenant_card_idx","valid":true},{"hash":"056bb8de901483125efe2732523d819e","name":"recommendations_tenant_status_idx","valid":true},{"hash":"a476e2d28c07971b928eda86c80e751e","name":"recommendations_tenant_status_severity_idx","valid":true},{"hash":"b95ef336ff6b0a8f8a125f41104f3e3e","name":"recommendations_tenant_type_idx","valid":true}],"forceRls":false,"policies":[{"name":"recommendations_select_tenant","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"597b55ea6549f6b047ec6f9016ef52b7","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"f2e4bf560632a22b01ec24756b729226","name":"recommendations_set_updated_at","enabled":"O"}],"constraints":[{"hash":"16ce9eb1c3ccb3f136a3b2d98da3b1a0","kind":"f","name":"recommendations_card_id_fkey","validated":true},{"hash":"1c3ad5fe49e5a4a7c102b2e857567fd7","kind":"f","name":"recommendations_interaction_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"recommendations_pkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"team_members","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"tenant_id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"profile_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"org_unit_id","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"formal_role","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"observed_role","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"observed_status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"c52f9c62eaaccb25ee4a31f5d7985d5f"},{"name":"authority_level","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"af8c0c74e3183c2818bc9d953905fd3b"},{"name":"confidence","type":"numeric","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"evidence","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"8b4b2df56ad0773943ef9179742da01b"},{"name":"source","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"dc1aa1465ec03c693f1c71ed37ae624c"},{"name":"confirmed_by","type":"uuid","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"confirmed_at","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"effective_from","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"effective_to","type":"timestamp with time zone","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"version","type":"integer","notNull":true,"identity":"","generated":"","defaultHash":"c4ca4238a0b923820dcc509a6f75849b"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"702f51d0616b95af6acceac770041d90","name":"team_members_id_tenant_uk","valid":true},{"hash":"3050f5b55154f2c1f333d5ac4620ed9f","name":"team_members_pkey","valid":true},{"hash":"4c7c3c5008c60803c6e0cdc1c63d4724","name":"team_members_profile","valid":true},{"hash":"d1291cf097138ed6a8e370ba09879e2c","name":"team_members_tenant","valid":true}],"forceRls":false,"policies":[{"name":"team_members_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"8031287eec47c1930002b085151d833d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"20470c2fa4bfa1cfd511bff609c9327a","name":"learn_capture_member_change","enabled":"O"},{"hash":"1f88777e8f895faa6f75f677f577a205","name":"learn_foundation_reference_guard","enabled":"O"},{"hash":"81116ed1f8bd3359a358eb8c192755eb","name":"learn_member_no_delete","enabled":"O"},{"hash":"4903df4fb40be1ac178cfdf9148826be","name":"learn_member_no_truncate","enabled":"O"},{"hash":"d45827f37e95f2ee646f5f6fa087fd33","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"d436df6318ac765e417b873eaff97451","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"b419d5db1c118ff5d4e1f4a175ef311a","name":"team_members_set_updated_at","enabled":"O"}],"constraints":[{"hash":"ff1dd41640b0c5def6891c12630f5f29","kind":"c","name":"team_members_authority_level_check","validated":true},{"hash":"fe05d9f5fdc7c955f732c72e312b120c","kind":"c","name":"team_members_confidence_check","validated":true},{"hash":"0b3438f4f2c60569832a789b448f8a4d","kind":"c","name":"team_members_observed_status_check","validated":true},{"hash":"c773fa58011794721f1db6b5021ef422","kind":"f","name":"team_members_org_unit_id_fkey","validated":true},{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"team_members_pkey","validated":true},{"hash":"695f2bdba621667ae56a0544d2ad1ec2","kind":"f","name":"team_members_tenant_id_fkey","validated":true}]},{"acl":[{"role":"anon","grantable":false,"privilege":"DELETE"},{"role":"anon","grantable":false,"privilege":"INSERT"},{"role":"anon","grantable":false,"privilege":"MAINTAIN"},{"role":"anon","grantable":false,"privilege":"REFERENCES"},{"role":"anon","grantable":false,"privilege":"SELECT"},{"role":"anon","grantable":false,"privilege":"TRIGGER"},{"role":"anon","grantable":false,"privilege":"TRUNCATE"},{"role":"anon","grantable":false,"privilege":"UPDATE"},{"role":"authenticated","grantable":false,"privilege":"DELETE"},{"role":"authenticated","grantable":false,"privilege":"INSERT"},{"role":"authenticated","grantable":false,"privilege":"MAINTAIN"},{"role":"authenticated","grantable":false,"privilege":"REFERENCES"},{"role":"authenticated","grantable":false,"privilege":"SELECT"},{"role":"authenticated","grantable":false,"privilege":"TRIGGER"},{"role":"authenticated","grantable":false,"privilege":"TRUNCATE"},{"role":"authenticated","grantable":false,"privilege":"UPDATE"},{"role":"postgres","grantable":false,"privilege":"DELETE"},{"role":"postgres","grantable":false,"privilege":"INSERT"},{"role":"postgres","grantable":false,"privilege":"MAINTAIN"},{"role":"postgres","grantable":false,"privilege":"REFERENCES"},{"role":"postgres","grantable":false,"privilege":"SELECT"},{"role":"postgres","grantable":false,"privilege":"TRIGGER"},{"role":"postgres","grantable":false,"privilege":"TRUNCATE"},{"role":"postgres","grantable":false,"privilege":"UPDATE"},{"role":"service_role","grantable":false,"privilege":"DELETE"},{"role":"service_role","grantable":false,"privilege":"INSERT"},{"role":"service_role","grantable":false,"privilege":"MAINTAIN"},{"role":"service_role","grantable":false,"privilege":"REFERENCES"},{"role":"service_role","grantable":false,"privilege":"SELECT"},{"role":"service_role","grantable":false,"privilege":"TRIGGER"},{"role":"service_role","grantable":false,"privilege":"TRUNCATE"},{"role":"service_role","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"tenants","owner":"postgres","columns":[{"name":"id","type":"uuid","notNull":true,"identity":"","generated":"","defaultHash":"f3b72bb359a50b640590970a2ab8e514"},{"name":"slug","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"display_name","type":"text","notNull":true,"identity":"","generated":"","defaultHash":null},{"name":"industry","type":"text","notNull":false,"identity":"","generated":"","defaultHash":null},{"name":"status","type":"text","notNull":true,"identity":"","generated":"","defaultHash":"cfaf8d9e8ae4be644c6e743d4de4ac24"},{"name":"metadata","type":"jsonb","notNull":true,"identity":"","generated":"","defaultHash":"f3db357cf4f4a03883484fa3281a056c"},{"name":"created_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"},{"name":"updated_at","type":"timestamp with time zone","notNull":true,"identity":"","generated":"","defaultHash":"75230039beb12ce952f24927f2bfa2f2"}],"indexes":[{"hash":"5284b9c618f8618b72a402ea2c593753","name":"tenants_pkey","valid":true},{"hash":"6260c986ce2d58a0ad3de3f74ec6eb6f","name":"tenants_slug_key","valid":true}],"forceRls":false,"policies":[{"name":"tenants_select","roles":["authenticated"],"command":"SELECT","checkHash":null,"usingHash":"831f798d620de1d73971187d41079b4d","permissive":"PERMISSIVE"}],"triggers":[{"hash":"8009f8efa07661ab809d3f9e077da55e","name":"learn_work_authority_input_lock","enabled":"O"},{"hash":"742cd63e2f0ed7809f0911b17d02869d","name":"learn_work_authority_truncate_lock","enabled":"O"},{"hash":"8a4d62ca55c88b97023eab7696e527ce","name":"tenants_set_updated_at","enabled":"O"}],"constraints":[{"hash":"4c6419b3704337bbfe50f018842a9ad3","kind":"p","name":"tenants_pkey","validated":true},{"hash":"687397275d0e852fb2a4b50394adffee","kind":"u","name":"tenants_slug_key","validated":true},{"hash":"7702cc7b97df1ebce81e13bb05db5c2d","kind":"c","name":"tenants_status_check","validated":true}]}]'::jsonb then raise exception 'Production Cards table baseline differs';end if;
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
) as inventory) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array['learn_capture_allowed','learn_operator_input_access','learn_operator_input_immutable','learn_phone_handoff','phone_projection_version']);
 if actual_helpers is distinct from '[{"hash":"cc8bc01c1ebd3da0c5f0ec5de3754667","name":"learn_capture_allowed","owner":"postgres","arguments":"p_tenant uuid, p_source text","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"6ebce242963afa929b7465a99e7608c6","name":"learn_operator_input_access","owner":"postgres","arguments":"p_tenant uuid, p_actor uuid, p_write boolean","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":false},{"hash":"0f17d77fbd9a9d6e3d9cff0c0ccee5c1","name":"learn_operator_input_immutable","owner":"postgres","arguments":"","anonExecute":false,"serviceExecute":false,"securityDefiner":false,"authenticatedExecute":false},{"hash":"54d7f8d821e5133ee017ff363053bca4","name":"learn_phone_handoff","owner":"postgres","arguments":"p_tenant uuid, p_run uuid, p_recording uuid, p_transcript uuid, p_insight uuid, p_phase text","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"1579e5985dbad97ec6d83345a11b182b","name":"phone_projection_version","owner":"postgres","arguments":"p_tenant_id uuid, p_call_id uuid","anonExecute":true,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":true}]'::jsonb then raise exception 'Production Cards helper baseline differs';end if;
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
 if actual_views is distinct from '[{"hash":"f9c7f18fbcf81cbd78d3ffae9ae65402","name":"controlplane_current_ownership_v","owner":"postgres","options":["security_invoker=true"]},{"hash":"a0e44ad30cc37aaa59ff57b4c1eff2e1","name":"learn_launch_email_accounts","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"1e1cc7c2951a77221ae568bc1c8b6b48","name":"learn_launch_email_messages","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"7e335ca092e0b76374c040c58c4083c4","name":"learn_launch_email_sync_runs","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"75b31dd7c4a5fbc66a3edd2af7714e63","name":"learn_launch_google_workspace_mailboxes","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"5b71f81069d25c9bc5325ce969212a5a","name":"learn_launch_phone_calls","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"5ee434eb72215563c83dd1851683a0b6","name":"learn_launch_phone_recordings","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"561f405293a8d41abe634d9c5b95649d","name":"learn_launch_phone_sync_runs","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"cbdbc17f610ecd6cc3965a17713670de","name":"learn_launch_phone_transcripts","owner":"learn_launch_metadata_reader","options":["security_barrier=true","security_invoker=false"]},{"hash":"2fd37022d57de7c4c6578bd92ee31b81","name":"phone_recording_pipeline_state","owner":"postgres","options":["security_invoker=on"]},{"hash":"afd8b68d88fdbeddfe6dc42c8be29f82","name":"recommendation_objects","owner":"postgres","options":["security_invoker=on"]},{"hash":"f03f36c81d9588d216b8a3b4ea66ceee","name":"recommendations_compat","owner":"postgres","options":["security_invoker=on"]},{"hash":"46995b89f37421d838589b7fb5b1462a","name":"response_refinement_trail","owner":"postgres","options":["security_invoker=true"]}]'::jsonb then raise exception 'Production Cards view baseline differs';end if;
end$$;
create role learn_card_communication_reader nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant learn_card_communication_reader to postgres with inherit true, set true;
grant usage on schema public,auth to learn_card_communication_reader;
grant create on schema public to learn_card_communication_reader;
grant execute on function auth.uid() to learn_card_communication_reader;
grant select(id,tenant_id,role) on public.profiles to learn_card_communication_reader;
create policy learn_card_communication_profile on public.profiles for select to learn_card_communication_reader using(id=(select auth.uid()));
grant select(id,tenant_id,source_connector_id,source_type,source_table,source_id,occurred_at,subject,summary,body_preview,status,related_person_id,related_company_id,related_job_id) on public.interactions to learn_card_communication_reader;
create policy learn_card_communication_read on public.interactions for select to learn_card_communication_reader
 using(tenant_id in(select p.tenant_id from public.profiles p where p.id=(select auth.uid()) and p.role in ('owner','admin')));

create function public.learn_card_communications_read(p_tenant uuid,p_person uuid default null,p_company uuid default null,p_job uuid default null,p_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor_tenant uuid;actor_role text;result jsonb;
begin
 select p.tenant_id,p.role into actor_tenant,actor_role from public.profiles p where p.id=auth.uid();
 if auth.uid() is null or actor_tenant is distinct from p_tenant or coalesce(actor_role,'') not in ('owner','admin') then
  raise exception 'Company owner/admin communication access required' using errcode='42501';end if;
 if p_tenant is null or
  (p_ids is null and p_person is null and p_company is null and p_job is null) or
  (p_ids is not null and (cardinality(p_ids)<1 or cardinality(p_ids)>50 or array_position(p_ids,null) is not null or p_person is not null or p_company is not null or p_job is not null)) or
  (p_job is not null and (p_person is not null or p_company is not null)) then
  raise exception 'One bounded communication scope is required' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.occurred_at desc nulls last,s.id),'[]'::jsonb) into result from (
  select i.id,i.tenant_id,i.source_connector_id,i.source_type,i.source_table,i.source_id,i.occurred_at,
   case when length(i.subject)>4000 then left(i.subject,4000)||'… [excerpt shortened]' else i.subject end as subject,
   case when length(i.summary)>4000 then left(i.summary,4000)||'… [excerpt shortened]' else i.summary end as summary,
   case when length(i.body_preview)>4000 then left(i.body_preview,4000)||'… [excerpt shortened]' else i.body_preview end as body_preview,
   i.status,i.related_person_id,i.related_company_id,i.related_job_id
  from public.interactions i where i.tenant_id=p_tenant and coalesce(i.status,'') not in ('deleted','removed') and
   (i.related_person_id=p_person or i.related_company_id=p_company or i.related_job_id=p_job or i.id=any(p_ids))
  order by i.occurred_at desc nulls last,i.id limit 51
 ) s;
 return jsonb_build_object('version','learn-card-communications/1','tenant_id',p_tenant,'rows',result);
end $$;
revoke all on function public.learn_card_communications_read(uuid,uuid,uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.learn_card_communications_read(uuid,uuid,uuid,uuid,uuid[]) to authenticated;
alter function public.learn_card_communications_read(uuid,uuid,uuid,uuid,uuid[]) owner to learn_card_communication_reader;



create or replace function public.learn_card_communications_read(p_tenant uuid,p_person uuid default null,p_company uuid default null,p_job uuid default null,p_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor_tenant uuid;actor_role text;result jsonb;
begin
 -- The reader role can see only the actual caller profile through its RLS policy.
 -- Policies bind auth.uid() at creation; runtime auth-schema lookup is unnecessary.
 select p.tenant_id,p.role into actor_tenant,actor_role from public.profiles p;
 if actor_tenant is distinct from p_tenant or coalesce(actor_role,'') not in ('owner','admin') then
  raise exception 'Company owner/admin communication access required' using errcode='42501';end if;
 if p_tenant is null or
  (p_ids is null and p_person is null and p_company is null and p_job is null) or
  (p_ids is not null and (cardinality(p_ids)<1 or cardinality(p_ids)>50 or array_position(p_ids,null) is not null or p_person is not null or p_company is not null or p_job is not null)) or
  (p_job is not null and (p_person is not null or p_company is not null)) then
  raise exception 'One bounded communication scope is required' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.occurred_at desc nulls last,s.id),'[]'::jsonb) into result from (
  select i.id,i.tenant_id,i.source_connector_id,i.source_type,i.source_table,i.source_id,i.occurred_at,
   case when length(i.subject)>4000 then left(i.subject,4000)||'… [excerpt shortened]' else i.subject end as subject,
   case when length(i.summary)>4000 then left(i.summary,4000)||'… [excerpt shortened]' else i.summary end as summary,
   case when length(i.body_preview)>4000 then left(i.body_preview,4000)||'… [excerpt shortened]' else i.body_preview end as body_preview,
   i.status,i.related_person_id,i.related_company_id,i.related_job_id
  from public.interactions i where i.tenant_id=p_tenant and coalesce(i.status,'') not in ('deleted','removed') and
   (i.related_person_id=p_person or i.related_company_id=p_company or i.related_job_id=p_job or i.id=any(p_ids))
  order by i.occurred_at desc nulls last,i.id limit 51
 ) s;
 return jsonb_build_object('version','learn-card-communications/1','tenant_id',p_tenant,'rows',result);
end $$;

grant select(id,tenant_id,subject,snippet,sent_at,received_at,direction) on public.email_messages to learn_card_communication_reader;
grant select(id,tenant_id,provider,direction,started_at,duration_seconds,outcome) on public.phone_calls to learn_card_communication_reader;
grant select(id,tenant_id,provider,started_at,duration_seconds) on public.phone_recordings to learn_card_communication_reader;
create policy learn_card_email_source_read on public.email_messages for select to learn_card_communication_reader
 using(tenant_id in(select p.tenant_id from public.profiles p where p.role in ('owner','admin')));
create policy learn_card_call_source_read on public.phone_calls for select to learn_card_communication_reader
 using(tenant_id in(select p.tenant_id from public.profiles p where p.role in ('owner','admin')));
create policy learn_card_recording_source_read on public.phone_recordings for select to learn_card_communication_reader
 using(tenant_id in(select p.tenant_id from public.profiles p where p.role in ('owner','admin')));
create function public.learn_card_source_read(p_tenant uuid,p_table text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor_tenant uuid;actor_role text;result jsonb;
begin
 -- Profile RLS exposes only the actual caller. The reader has no auth-schema access.
 select p.tenant_id,p.role into actor_tenant,actor_role from public.profiles p;
 if actor_tenant is distinct from p_tenant or coalesce(actor_role,'') not in ('owner','admin') then
  raise exception 'Company owner/admin source access required' using errcode='42501';end if;
 if p_tenant is null or p_id is null or p_table is null or p_table not in ('email_messages','phone_calls','phone_recordings') then
  raise exception 'One supported source reference required' using errcode='22023';end if;
 if p_table='email_messages' then
  select to_jsonb(s) into result from (
   select id,tenant_id,
    case when length(subject)>4000 then left(subject,4000)||'… [excerpt shortened]' else subject end as subject,
    case when length(snippet)>4000 then left(snippet,4000)||'… [excerpt shortened]' else snippet end as snippet,
    sent_at,received_at,case when length(direction)>4000 then left(direction,4000)||'… [excerpt shortened]' else direction end as direction
   from public.email_messages where tenant_id=p_tenant and id=p_id
  ) s;
 elsif p_table='phone_calls' then
  select to_jsonb(s) into result from (
   select id,tenant_id,
    case when length(provider)>4000 then left(provider,4000)||'… [excerpt shortened]' else provider end as provider,
    case when length(direction)>4000 then left(direction,4000)||'… [excerpt shortened]' else direction end as direction,
    started_at,duration_seconds,
    case when length(outcome)>4000 then left(outcome,4000)||'… [excerpt shortened]' else outcome end as outcome
   from public.phone_calls where tenant_id=p_tenant and id=p_id
  ) s;
 else
  select to_jsonb(s) into result from (
   select id,tenant_id,
    case when length(provider)>4000 then left(provider,4000)||'… [excerpt shortened]' else provider end as provider,
    started_at,duration_seconds
   from public.phone_recordings where tenant_id=p_tenant and id=p_id
  ) s;
 end if;
 return jsonb_build_object('version','learn-card-source/1','tenant_id',p_tenant,'table',p_table,'id',p_id,'record',result);
end $$;
revoke all on function public.learn_card_source_read(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_card_source_read(uuid,text,uuid) to authenticated;
alter function public.learn_card_source_read(uuid,text,uuid) owner to learn_card_communication_reader;

create policy learn_cards_production_boundary on public.profiles as restrictive for select to learn_card_communication_reader using(id=(select auth.uid()));
create policy learn_cards_production_boundary on public.interactions as restrictive for select to learn_card_communication_reader using(tenant_id in(select p.tenant_id from public.profiles p where p.id=(select auth.uid()) and p.role in ('owner','admin')));
create policy learn_cards_production_boundary on public.email_messages as restrictive for select to learn_card_communication_reader using(tenant_id in(select p.tenant_id from public.profiles p where p.role in ('owner','admin')));
create policy learn_cards_production_boundary on public.phone_calls as restrictive for select to learn_card_communication_reader using(tenant_id in(select p.tenant_id from public.profiles p where p.role in ('owner','admin')));
create policy learn_cards_production_boundary on public.phone_recordings as restrictive for select to learn_card_communication_reader using(tenant_id in(select p.tenant_id from public.profiles p where p.role in ('owner','admin')));
-- INPUT supabase/migrations/20261101150000_learn_card_search.sql
-- Literal canonical-card search under the caller's existing table permissions/RLS.
-- No source imports, identity matching, scoring writes or table-grant changes.

create function public.learn_card_search(p_tenant uuid,p_kind text,p_query text,p_page integer default 0,p_group uuid default null)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare term text:=btrim(p_query); matches jsonb; result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign-in required' using errcode='42501';end if;
 if p_tenant is null or p_kind is null or p_kind not in ('customer','job','member','team')
  or term is null or char_length(term) not between 1 and 120 or term ~ '[[:cntrl:]]'
  or p_page is null or p_page not between 0 and 10000
  or (p_group is not null and p_kind not in ('member','team')) then
  raise exception 'Invalid card search' using errcode='22023';end if;
 case p_kind
 when 'customer' then
  select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at desc nulls last,r.id),'[]'::jsonb) into matches
  from (select id,tenant_id,title,summary,person_id,company_id,owner_id,updated_at from public.customer_cards where tenant_id=p_tenant and true
   and (strpos(lower(coalesce(title,'')),lower(term))>0) order by updated_at desc nulls last,id limit 25 offset p_page*24) r;
 when 'job' then
  select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at desc nulls last,r.id),'[]'::jsonb) into matches
  from (select id,tenant_id,title,job_number,status,source_system,verified,updated_at from public.jobs where tenant_id=p_tenant and true
   and (strpos(lower(coalesce(title,'')),lower(term))>0 or strpos(lower(coalesce(job_number,'')),lower(term))>0) order by updated_at desc nulls last,id limit 25 offset p_page*24) r;
 when 'member' then
  select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at desc nulls last,r.id),'[]'::jsonb) into matches
  from (select id,tenant_id,display_name,formal_role,org_unit_id,profile_id,confirmed_at,effective_to,updated_at from public.team_members where tenant_id=p_tenant and effective_to is null and (p_group is null or org_unit_id=p_group)
   and (strpos(lower(coalesce(display_name,'')),lower(term))>0 or strpos(lower(coalesce(formal_role,'')),lower(term))>0) order by updated_at desc nulls last,id limit 25 offset p_page*24) r;
 when 'team' then
  select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at desc nulls last,r.id),'[]'::jsonb) into matches
  from (select id,tenant_id,name,kind,updated_at from public.org_units where tenant_id=p_tenant and (p_group is null or id=p_group)
   and (strpos(lower(coalesce(name,'')),lower(term))>0) order by updated_at desc nulls last,id limit 25 offset p_page*24) r;
 end case;
 select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into result
 from jsonb_array_elements(matches) with ordinality r(value,ord) where ord<=24;
 return jsonb_build_object('version','learn-card-search/1','tenantId',p_tenant,'kind',p_kind,'query',term,
  'page',p_page,'groupId',p_group,'rows',result,'hasMore',jsonb_array_length(matches)>24);
end $$;
revoke all on function public.learn_card_search(uuid,text,text,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_card_search(uuid,text,text,integer,uuid) to authenticated;

-- INPUT supabase/migrations/20261101300000_learn_identity_delivery.sql
-- Atomic identity/card delivery from one exact canonical interaction revision.
-- No source rewrites, schedules, credentials or raw client DML grants.

set local lock_timeout='5s';set local statement_timeout='30s';
create table public.learn_identity_delivery_receipts(
 request_id uuid primary key,tenant_id uuid not null references public.tenants(id),
 interaction_id uuid not null references public.interactions(id),
 source_revision text not null check(source_revision ~ '^[a-f0-9]{64}$'),
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_identity_delivery_receipts enable row level security;
revoke all on public.learn_identity_delivery_receipts from public,anon,authenticated,service_role;
create trigger learn_identity_delivery_receipts_immutable before update or delete on public.learn_identity_delivery_receipts
 for each row execute function public.learn_operator_input_immutable();

create function public.learn_identity_revision(p_interaction public.interactions) returns text
 language sql stable strict set search_path=pg_catalog set timezone='UTC' as $$
 select encode(sha256(convert_to(to_jsonb(p_interaction)::text,'UTF8')),'hex')
$$;
revoke all on function public.learn_identity_revision(public.interactions) from public,anon,authenticated,service_role;

create function public.learn_identity_pending(p_tenant uuid,p_limit integer default 20)
 returns table(interaction_id uuid,source_revision text)
 language sql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
 select i.id,public.learn_identity_revision(i) from public.interactions i
 join public.tenants t on t.id=i.tenant_id and t.status='active'
 where i.tenant_id=p_tenant and i.processing_status in('pending','ready')
 order by i.occurred_at,i.id limit greatest(1,least(50,coalesce(p_limit,20)))
$$;
revoke all on function public.learn_identity_pending(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_identity_pending(uuid,integer) to service_role;

create function public.learn_identity_deliver(p_tenant uuid,p_request uuid,p_interaction uuid,p_revision text,p_phase text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
#variable_conflict use_column
<<delivery>>
declare
 i public.interactions%rowtype;p public.people%rowtype;c public.companies%rowtype;card public.customer_cards%rowtype;
 saved public.learn_identity_delivery_receipts%rowtype;event public.platform_events%rowtype;
 email text;phone text;contact_name text;domain text;person_id uuid;company_id uuid;email_id uuid;phone_id uuid;
 matches integer;created_person boolean:=false;created_company boolean:=false;new_card boolean:=false;
 reason text;confidence numeric:=0;evidence jsonb:='[]';company_evidence jsonb:='[]';person_level text:='possible';
 answer jsonb;suggestions integer:=0;recs integer:=0;consumed integer:=0;affected integer:=0;
 interaction_count integer;today_count integer;open_rec_score integer;priority_score integer;priority_bucket text;
 start_today timestamptz:=date_trunc('day',statement_timestamp());activity timestamptz;has_phone_receipt boolean;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'identity_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_request is null or p_interaction is null or coalesce(p_revision,'') !~ '^[a-f0-9]{64}$'
 or p_phase is null or p_phase not in('publish','inspect') then raise exception 'identity_request_invalid' using errcode='22023';end if;
 select * into saved from public.learn_identity_delivery_receipts where request_id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.interaction_id<>p_interaction or saved.source_revision<>p_revision then raise exception 'identity_receipt_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 if p_phase='inspect' then raise exception 'identity_receipt_missing' using errcode='PT409';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 -- Serialise this engine's provisional identity creation within the tenant.
 perform pg_advisory_xact_lock(hashtextextended('learn-identity:'||p_tenant::text,0));
 select * into saved from public.learn_identity_delivery_receipts where request_id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.interaction_id<>p_interaction or saved.source_revision<>p_revision then raise exception 'identity_receipt_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'identity_tenant_inactive' using errcode='PT409';end if;
 select * into i from public.interactions where tenant_id=p_tenant and id=p_interaction for update;
 if not found or public.learn_identity_revision(i)<>p_revision or i.processing_status not in('pending','ready','identity_review')
 then raise exception 'identity_source_changed' using errcode='PT409';end if;
 select * into event from public.platform_events where tenant_id=p_tenant and event_type='interaction.ready' and subject_type='interaction'
 and subject_id=i.id and status='pending' for update;
 has_phone_receipt:=i.metadata->'phone_handoff'->>'version'='learn-phone-handoff/1';
 if coalesce(has_phone_receipt,false) and (event.id is null or event.payload->>'source_fingerprint' is distinct from i.metadata->'phone_handoff'->>'sourceFingerprint')
 then raise exception 'identity_event_changed' using errcode='PT409';end if;
 if i.direction='internal' then reason:='internal_interaction';
 elsif i.direction not in('inbound','outbound') or i.direction is null then reason:='direction_unverified';end if;
 email:=nullif(lower(btrim(case when i.direction='outbound' then i.to_addresses[1] else i.from_address end)),'');
 phone:=nullif(btrim(case when i.direction='outbound' then i.phone_to else i.phone_from end),'');
 contact_name:=case when i.direction='inbound' then nullif(btrim(i.from_name),'') else null end;
 -- Treat provider text as data. No dynamic filters or SQL are built from identifiers.
 if email is not null and email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then reason:=coalesce(reason,'email_unverified');end if;
 if phone is not null and phone !~ '^\+?[0-9][0-9 ()-]{4,30}$' then reason:=coalesce(reason,'phone_unverified');end if;
 if email is null and phone is null then reason:=coalesce(reason,'contact_missing');end if;
 if reason is null and email is not null then
  select count(*),min(x.id::text)::uuid into matches,email_id from public.people x where x.tenant_id=p_tenant and lower(btrim(x.primary_email))=email;
  if matches>1 then reason:='person_ambiguous';end if;
 end if;
 if reason is null and phone is not null then
  select count(*),min(x.id::text)::uuid into matches,phone_id from public.people x where x.tenant_id=p_tenant and btrim(x.primary_phone)=phone;
  if matches>1 then reason:='person_ambiguous';end if;
 end if;
 if reason is null and email_id is not null and phone_id is not null and email_id<>phone_id then reason:='person_conflict';end if;
 if reason is null then
  person_id:=coalesce(email_id,phone_id);
  if i.related_person_id is not null then
   perform 1 from public.people where tenant_id=p_tenant and id=i.related_person_id;
   if not found then reason:='person_link_invalid';
   elsif person_id is not null and person_id<>i.related_person_id then reason:='person_link_conflict';
   else person_id:=i.related_person_id;end if;
  end if;
 end if;
 if reason is null and person_id is not null then
  select * into p from public.people where tenant_id=p_tenant and id=person_id for update;
  if not found then raise exception 'identity_source_changed' using errcode='PT409';end if;
  confidence:=case when email_id=person_id then 0.95 when phone_id=person_id then 0.92 else 0 end;
  person_level:=case when confidence>=0.9 then 'confirmed' else 'possible' end;
  evidence:=jsonb_build_array(jsonb_build_object('source',case when email_id=person_id then 'email' when phone_id=person_id then 'phone' else 'existing_interaction_link' end,
   'detail',case when confidence>=0.9 then 'Unique exact contact match within this tenant' else 'Preserved existing interaction attribution; contact match unverified' end,'weight',confidence));
  company_id:=coalesce(i.related_company_id,p.company_id);
  if i.related_company_id is not null and p.company_id is not null and i.related_company_id<>p.company_id then reason:='company_link_conflict';end if;
 else company_id:=i.related_company_id;end if;
 if reason is null and company_id is not null then
  select * into c from public.companies where tenant_id=p_tenant and id=company_id for share;
  if not found then reason:='company_link_invalid';end if;
 end if;
 if reason is null and company_id is null and email is not null then
  domain:=split_part(email,'@',2);
  if domain<>all(array['gmail.com','googlemail.com','outlook.com','hotmail.com','hotmail.co.uk','live.com','yahoo.com','yahoo.co.uk','icloud.com','me.com','aol.com','btinternet.com','sky.com','msn.com','protonmail.com','gmx.com']) then
   select count(*),min(x.id::text)::uuid into matches,company_id from public.companies x where x.tenant_id=p_tenant and lower(btrim(x.domain))=domain;
   if matches>1 then reason:='company_ambiguous';
   elsif company_id is not null then
    select * into c from public.companies where tenant_id=p_tenant and id=company_id for share;
    company_evidence:=jsonb_build_array(jsonb_build_object('source','email_domain','detail','Unique company domain match; provisional attribution','weight',0.85));
   end if;
  else domain:=null;end if;
 end if;
 if reason is null and exists(select 1 from public.interaction_match_suggestions s where s.tenant_id=p_tenant and s.interaction_id=i.id and s.status='rejected' and ((s.target_type='person' and s.target_id=person_id) or (s.target_type='company' and s.target_id=company_id))) then reason:='reviewed_match_rejected';end if;
 -- Never consume a signal or invent a card when its external identity needs review.
 if reason is not null then
  update public.interactions set processing_status='identity_review',metadata=metadata||jsonb_build_object('identity_delivery',jsonb_build_object('state','review_required','reason',reason,'requestId',p_request)) where id=i.id and tenant_id=p_tenant;
  get diagnostics affected=row_count;if affected<>1 then raise exception 'identity_source_changed' using errcode='PT409';end if;
  answer:=jsonb_build_object('version','learn-identity-delivery/1','state','review_required','tenantId',p_tenant,'requestId',p_request,'interactionId',i.id,'sourceRevision',p_revision,'reason',reason,'cardId',null,'personCreated',false,'companyCreated',false,'cardEnriched',false,'recommendations',0,'suggestions',0,'eventsConsumed',0);
 else
  if company_id is null and domain is not null then
   insert into public.companies(tenant_id,name,domain,verified,created_source) values(p_tenant,domain,domain,false,'interaction') returning id into company_id;
   created_company:=true;
  end if;
  if person_id is null then
   insert into public.people(tenant_id,primary_email,primary_phone,display_name,company_id,verified,created_source,metadata)
    values(p_tenant,email,phone,contact_name,company_id,false,'interaction',jsonb_build_object('origin_interaction',i.id)) returning * into p;
   person_id:=p.id;created_person:=true;confidence:=0;
   evidence:=jsonb_build_array(jsonb_build_object('source','interaction','detail','Provisional contact created from source identifier; identity review required','weight',0));
  end if;
  -- Preserve reviewed suggestions instead of resetting accepted/rejected decisions.
  if not created_person then
   insert into public.interaction_match_suggestions as s(tenant_id,interaction_id,target_type,target_id,match_level,confidence,evidence,explanation,recommended_action,status,created_by)
    values(p_tenant,i.id,'person',person_id,person_level,confidence,evidence,'Contact evidence retained with the interaction','Review contact attribution','pending','system')
    on conflict(tenant_id,interaction_id,target_type,target_id) do update set confidence=excluded.confidence,evidence=excluded.evidence,explanation=excluded.explanation where s.status='pending';
   get diagnostics suggestions=row_count;
  end if;
  if company_id is not null and company_evidence<>'[]'::jsonb then
   insert into public.interaction_match_suggestions as s(tenant_id,interaction_id,target_type,target_id,match_level,confidence,evidence,explanation,status,created_by)
    values(p_tenant,i.id,'company',company_id,'likely',0.85,company_evidence,'Provisional attribution from company domain','pending','system')
    on conflict(tenant_id,interaction_id,target_type,target_id) do update set evidence=excluded.evidence where s.status='pending';
   get diagnostics affected=row_count;suggestions:=suggestions+affected;
  end if;
  -- Link inside this transaction so aggregate counts include this interaction.
  update public.interactions set related_person_id=person_id,related_company_id=company_id where tenant_id=p_tenant and id=i.id;
  get diagnostics affected=row_count;if affected<>1 then raise exception 'identity_source_changed' using errcode='PT409';end if;
  select count(*),count(*) filter(where occurred_at>=start_today and occurred_at<start_today+interval '1 day') into interaction_count,today_count
   from public.interactions where tenant_id=p_tenant and related_person_id=person_id;
  select * into card from public.customer_cards x where x.tenant_id=p_tenant and x.person_id=delivery.person_id for update;
  if not found then
   insert into public.customer_cards(tenant_id,person_id,company_id,title,summary,latest_activity_at,confidence)
    values(p_tenant,person_id,company_id,coalesce(contact_name,p.display_name,email,phone),coalesce(i.summary,i.body_preview),i.occurred_at,confidence)
    on conflict(tenant_id,person_id) where person_id is not null do nothing returning * into card;
   new_card:=found;
   if not new_card then select * into card from public.customer_cards x where x.tenant_id=p_tenant and x.person_id=delivery.person_id for update;end if;
  end if;
  if card.id is null then raise exception 'identity_card_unconfirmed' using errcode='PT409';end if;
  if today_count>=2 then
   insert into public.recommendations(tenant_id,type,title,detail,severity,status,card_id,interaction_id,person_id,company_id,evidence,recommended_action,created_by)
    values(p_tenant,'repeat_contact_today','Repeated contact today','Multiple interactions recorded during the current UTC day; review response needs.','high','open',card.id,i.id,person_id,company_id,
     jsonb_build_array(jsonb_build_object('source','interactions','count',today_count,'periodStart',start_today,'timezone','UTC')),'Review and respond','system')
    on conflict(tenant_id,card_id,type) where status='open' and card_id is not null do nothing;
   get diagnostics affected=row_count;recs:=recs+affected;
  end if;
  if created_person then
   insert into public.recommendations(tenant_id,type,title,detail,severity,status,card_id,interaction_id,person_id,company_id,evidence,recommended_action,created_by)
    values(p_tenant,'review_new_contact','New contact — confirm identity','Provisional contact from a source interaction; confirm or link it.','info','open',card.id,i.id,person_id,company_id,evidence,'Review and confirm the contact','system')
    on conflict(tenant_id,card_id,type) where status='open' and card_id is not null do nothing;
   get diagnostics affected=row_count;recs:=recs+affected;
  end if;
  select coalesce(sum(case severity when 'critical' then 30 when 'high' then 20 when 'medium' then 10 when 'low' then 5 else 2 end),0) into open_rec_score
   from public.recommendations where tenant_id=p_tenant and card_id=card.id and status='open';
  priority_score:=least(100,20+least(30,interaction_count*5)+open_rec_score+case when i.sentiment='negative' then 20 else 0 end+case when today_count>=2 then 15 else 0 end);
  priority_bucket:=case when priority_score>=75 then 'critical' when priority_score>=50 then 'high' when priority_score>=25 then 'medium' else 'low' end;
  activity:=greatest(card.latest_activity_at,i.occurred_at);
  -- Read locks and manual values at commit time, not from a stale client snapshot.
  update public.customer_cards x set
   company_id=case when 'company_id'=any(card.locked_fields) then x.company_id else delivery.company_id end,
   title=case when 'title'=any(card.locked_fields) then x.title else coalesce(contact_name,p.display_name,email,phone,x.title) end,
   summary=case when 'summary'=any(card.locked_fields) or card.latest_activity_at>i.occurred_at then x.summary else coalesce(i.summary,i.body_preview,x.summary) end,
   latest_activity_at=case when 'latest_activity_at'=any(card.locked_fields) then x.latest_activity_at else activity end,
   confidence=case when 'confidence'=any(card.locked_fields) then x.confidence else delivery.confidence end,
   priority=case when card.locked_fields&&array['priority','priority_score','priority_inputs'] then x.priority else priority_bucket end,
   priority_score=case when card.locked_fields&&array['priority','priority_score','priority_inputs'] then x.priority_score else delivery.priority_score end,
   priority_inputs=case when card.locked_fields&&array['priority','priority_score','priority_inputs'] then x.priority_inputs else jsonb_build_object('version','identity-priority/2','interaction_count',interaction_count,'open_rec_score',open_rec_score,'negative_sentiment',i.sentiment='negative','repeat_today',today_count>=2,'periodStart',start_today,'timezone','UTC','sourceInteractionId',i.id,'sourceRevision',p_revision) end
   where x.tenant_id=p_tenant and x.id=card.id;
  get diagnostics affected=row_count;if affected<>1 then raise exception 'identity_card_unconfirmed' using errcode='PT409';end if;
  if event.id is not null then
   update public.platform_events set status='consumed',consumed_at=clock_timestamp(),metadata=metadata||jsonb_build_object('identity_delivery_request',p_request,'identity_source_revision',p_revision)
    where tenant_id=p_tenant and id=event.id and status='pending';
   get diagnostics consumed=row_count;if consumed<>1 then raise exception 'identity_event_changed' using errcode='PT409';end if;
  end if;
  update public.interactions set processing_status='enriched',metadata=metadata||jsonb_build_object('identity_delivery',jsonb_build_object('state','committed','requestId',p_request,'sourceRevision',p_revision,'cardId',card.id)) where tenant_id=p_tenant and id=i.id;
  get diagnostics affected=row_count;if affected<>1 then raise exception 'identity_source_changed' using errcode='PT409';end if;
  answer:=jsonb_build_object('version','learn-identity-delivery/1','state','committed','tenantId',p_tenant,'requestId',p_request,'interactionId',i.id,'sourceRevision',p_revision,'cardId',card.id,'personCreated',created_person,'companyCreated',created_company,'cardEnriched',true,'recommendations',recs,'suggestions',suggestions,'eventsConsumed',consumed);
 end if;
 insert into public.learn_identity_delivery_receipts(request_id,tenant_id,interaction_id,source_revision,receipt) values(p_request,p_tenant,i.id,p_revision,answer);
 return answer;
end$$;
revoke all on function public.learn_identity_deliver(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_identity_deliver(uuid,uuid,uuid,text,text) to service_role;

-- INPUT supabase/migrations/20261101310000_learn_interaction_projection.sql
-- Guarded repair/backfill from retained Phone/Email sources. No provider requests.

set local lock_timeout='5s';set local statement_timeout='30s';
create table public.learn_interaction_projection_receipts(
 request_id uuid primary key,tenant_id uuid not null references public.tenants(id),
 source_kind text not null check(source_kind in('phone','email')),source_id uuid not null,
 source_revision text not null check(source_revision ~ '^[a-f0-9]{64}$'),
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index learn_interaction_projection_source_idx on public.learn_interaction_projection_receipts(tenant_id,source_kind,source_id,source_revision);
alter table public.learn_interaction_projection_receipts enable row level security;
revoke all on public.learn_interaction_projection_receipts from public,anon,authenticated,service_role;
create trigger learn_interaction_projection_receipts_immutable before update or delete on public.learn_interaction_projection_receipts
 for each row execute function public.learn_operator_input_immutable();

create function public.learn_phone_source_fields(c public.phone_calls) returns jsonb language sql stable strict set search_path=pg_catalog set timezone='UTC' as $$
 select jsonb_build_object('source_connector_id',c.provider,'source_type','phone','source_table','phone_calls','source_id',c.id,
 'source_external_id',c.provider_call_id,'interaction_type','phone_call','direction',case c.direction when 'IN' then 'inbound' when 'OUT' then 'outbound' else 'unknown' end,
 'occurred_at',coalesce(c.started_at,c.created_at),'summary',null,'body_preview',concat('Call',case when c.duration_seconds is not null then ' · '||c.duration_seconds::text||'s' else '' end,case when c.outcome is not null then ' · '||c.outcome else '' end),
 'phone_from',c.from_number,'phone_to',c.to_number,'related_thread_id',c.linked_id)
$$;
create function public.learn_email_source_fields(m public.email_messages) returns jsonb language sql stable strict set search_path=pg_catalog set timezone='UTC' as $$
 select jsonb_build_object('source_connector_id','email','source_type','email','source_table','email_messages','source_id',m.id,
 'source_external_id',m.provider_message_id,'interaction_type','email_message','direction',case when m.direction in('inbound','outbound','internal') then m.direction else 'unknown' end,
 'occurred_at',coalesce(m.received_at,m.sent_at,m.created_at),'subject',m.subject,'summary',null,'body_preview',m.snippet,
 'from_address',m.from_email,'from_name',m.from_name,'to_addresses',m.to_emails,'cc_addresses',m.cc_emails,'related_thread_id',m.provider_thread_id)
$$;
create function public.learn_projection_revision(p_fields jsonb,p_version text default null) returns text language sql immutable strict set search_path=pg_catalog as $$
 select encode(sha256(convert_to(jsonb_build_object('fields',p_fields,'version',p_version)::text,'UTF8')),'hex')
$$;
-- NULL is meaningful for the optional authoritative version, so do not use STRICT.
alter function public.learn_projection_revision(jsonb,text) called on null input;
revoke all on function public.learn_phone_source_fields(public.phone_calls),public.learn_email_source_fields(public.email_messages),public.learn_projection_revision(jsonb,text) from public,anon,authenticated,service_role;

create function public.learn_projection_pending(p_tenant uuid,p_source text,p_limit integer default 100)
 returns table(source_kind text,source_id uuid,source_revision text)
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
begin
 if p_source is null or p_source not in('all','phone','email') then raise exception 'projection_source_invalid' using errcode='22023';end if;
 return query with candidates as (
  select 'phone'::text as kind,c.id,coalesce(c.started_at,c.created_at) as occurred,
   public.learn_projection_revision(public.learn_phone_source_fields(c),case when i.metadata?'phone_handoff' then public.phone_projection_version(p_tenant,c.id) else null end) as revision,
   i.id is null or case when i.metadata?'phone_handoff' then i.source_version is distinct from public.phone_projection_version(p_tenant,c.id)
    else i.metadata->'source_projection'->>'revision' is distinct from public.learn_projection_revision(public.learn_phone_source_fields(c),null) end as dirty
  from public.phone_calls c left join public.interactions i on i.tenant_id=c.tenant_id and i.source_table='phone_calls' and i.source_id=c.id
  where c.tenant_id=p_tenant and p_source in('all','phone')
  union all
  select 'email',m.id,coalesce(m.received_at,m.sent_at,m.created_at),public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id','')),
   i.id is null or i.metadata->'source_projection'->>'revision' is distinct from public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id',''))
  from public.email_messages m left join public.interactions i on i.tenant_id=m.tenant_id and i.source_table='email_messages' and i.source_id=m.id
  where m.tenant_id=p_tenant and p_source in('all','email')
 ) select x.kind,x.id,x.revision from candidates x where x.dirty
 and exists(select 1 from public.tenants t where t.id=p_tenant and t.status='active')
 and not exists(select 1 from public.learn_interaction_projection_receipts r where r.tenant_id=p_tenant and r.source_kind=x.kind and r.source_id=x.id and r.source_revision=x.revision and r.receipt->>'state'='review_required')
 order by x.occurred,x.kind,x.id limit greatest(1,least(2000,coalesce(p_limit,100)));
end$$;
revoke all on function public.learn_projection_pending(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_projection_pending(uuid,text,integer) to service_role;

create function public.learn_project_interaction(p_tenant uuid,p_request uuid,p_source text,p_source_id uuid,p_revision text,p_phase text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
#variable_conflict use_column
declare c public.phone_calls%rowtype;m public.email_messages%rowtype;i public.interactions%rowtype;
 saved public.learn_interaction_projection_receipts%rowtype;fields jsonb;actual text;table_name text;
 reason text;answer jsonb;event_id uuid;interaction_id uuid;created boolean:=false;prior_fields jsonb;
 provider text;version text;h jsonb;run_id uuid;campaign uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'projection_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_request is null or p_source is null or p_source not in('phone','email') or p_source_id is null
 or coalesce(p_revision,'') !~ '^[a-f0-9]{64}$' or p_phase is null or p_phase not in('publish','inspect') then raise exception 'projection_request_invalid' using errcode='22023';end if;
 select * into saved from public.learn_interaction_projection_receipts where request_id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.source_kind<>p_source or saved.source_id<>p_source_id or saved.source_revision<>p_revision then raise exception 'projection_receipt_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 if p_phase='inspect' then raise exception 'projection_receipt_missing' using errcode='PT409';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 perform pg_advisory_xact_lock(hashtextextended('learn-project:'||p_tenant::text||':'||p_source||':'||p_source_id::text,0));
 select * into saved from public.learn_interaction_projection_receipts where request_id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.source_kind<>p_source or saved.source_id<>p_source_id or saved.source_revision<>p_revision then raise exception 'projection_receipt_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 if not public.learn_capture_allowed(p_tenant,p_source) then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 table_name:=case p_source when 'phone' then 'phone_calls' else 'email_messages' end;
 -- Observe authoritative ownership before taking the legacy source lock. The
 -- phone publisher owns recording->run->transcript->insight->call->interaction.
 select * into i from public.interactions where tenant_id=p_tenant and source_table=table_name and source_id=p_source_id;
 if p_source='phone' and i.metadata?'phone_handoff' then
  select * into c from public.phone_calls where tenant_id=p_tenant and id=p_source_id;
  if not found then raise exception 'projection_source_changed' using errcode='PT409';end if;
  actual:=public.learn_projection_revision(public.learn_phone_source_fields(c),public.phone_projection_version(p_tenant,c.id));
  if actual<>p_revision then raise exception 'projection_source_changed' using errcode='PT409';end if;
  if i.source_version=public.phone_projection_version(p_tenant,c.id) then
   answer:=jsonb_build_object('version','learn-interaction-projection/1','state','committed','tenantId',p_tenant,'requestId',p_request,'sourceKind',p_source,'sourceId',p_source_id,'sourceRevision',p_revision,'interactionId',i.id,'eventId',null,'action','unchanged');
  else
  -- Only the existing exact-provenance publisher may refresh this interaction.
  run_id:=p_request;
  insert into public.phone_sync_runs(id,tenant_id,provider,sync_type,status,metadata)
   values(run_id,p_tenant,'pipeline','pipeline','running',jsonb_build_object('recording_id',i.metadata->'phone_handoff'->>'recordingId','repair_only',true,'source','interactions.sync'));
  h:=public.learn_phone_handoff(p_tenant,run_id,(i.metadata->'phone_handoff'->>'recordingId')::uuid,
   (i.metadata->'phone_handoff'->>'transcriptId')::uuid,(i.metadata->'phone_handoff'->>'insightId')::uuid,'publish');
  select * into c from public.phone_calls where tenant_id=p_tenant and id=p_source_id;
  if public.learn_projection_revision(public.learn_phone_source_fields(c),public.phone_projection_version(p_tenant,c.id))<>p_revision
   or h->>'callId'<>c.id::text or h->>'interactionId'<>i.id::text then raise exception 'projection_source_changed' using errcode='PT409';end if;
  update public.phone_sync_runs set status='success',completed_at=clock_timestamp(),records_processed=1,metadata=metadata||jsonb_build_object('handoff_receipt',h,'repair_only',true) where id=run_id and tenant_id=p_tenant;
  answer:=jsonb_build_object('version','learn-interaction-projection/1','state','committed','tenantId',p_tenant,'requestId',p_request,'sourceKind',p_source,'sourceId',p_source_id,'sourceRevision',p_revision,'interactionId',i.id,'eventId',h->'eventId','action',case when (h->>'alreadyEnriched')::boolean then 'unchanged' else 'authoritative_phone_refresh' end);
  end if;
 else
  if p_source='phone' then
   select * into c from public.phone_calls where tenant_id=p_tenant and id=p_source_id for update;
   if not found then raise exception 'projection_source_changed' using errcode='PT409';end if;
   fields:=public.learn_phone_source_fields(c);provider:=c.provider;version:=null;
  else
   select * into m from public.email_messages where tenant_id=p_tenant and id=p_source_id for update;
   if not found then raise exception 'projection_source_changed' using errcode='PT409';end if;
   fields:=public.learn_email_source_fields(m);provider:=m.provider;version:=coalesce(to_jsonb(m)->>'origin_campaign_id','');
   if version<>'' then campaign:=version::uuid;end if;
   if jsonb_typeof(m.to_emails) is distinct from 'array' or jsonb_typeof(m.cc_emails) is distinct from 'array'
    or exists(select 1 from jsonb_array_elements(m.to_emails||m.cc_emails) e where jsonb_typeof(e)<>'string') then reason:='email_addresses_unverified';end if;
  end if;
  actual:=public.learn_projection_revision(fields,version);
  if actual<>p_revision then raise exception 'projection_source_changed' using errcode='PT409';end if;
  select * into i from public.interactions where tenant_id=p_tenant and source_table=table_name and source_id=p_source_id for update;
  created:=not found;
  -- A concurrent live publisher may have won since the initial ownership read.
  if not created and i.metadata?'phone_handoff' then raise exception 'projection_owner_changed' using errcode='PT409';end if;
  if not created and not(i.metadata?'source_projection') then reason:=coalesce(reason,'legacy_projection_review');end if;
  if not created and i.metadata?'source_projection' then
   select jsonb_object_agg(k,to_jsonb(i)->k) into prior_fields from jsonb_object_keys(i.metadata->'source_projection'->'fields') k;
   if prior_fields is distinct from i.metadata->'source_projection'->'fields' then reason:=coalesce(reason,'canonical_fields_changed');end if;
  end if;
  if reason is not null then
   answer:=jsonb_build_object('version','learn-interaction-projection/1','state','review_required','tenantId',p_tenant,'requestId',p_request,'sourceKind',p_source,'sourceId',p_source_id,'sourceRevision',p_revision,'interactionId',i.id,'eventId',null,'action','held','reason',reason);
  elsif not created and i.metadata->'source_projection'->>'revision'=p_revision then
   answer:=jsonb_build_object('version','learn-interaction-projection/1','state','committed','tenantId',p_tenant,'requestId',p_request,'sourceKind',p_source,'sourceId',p_source_id,'sourceRevision',p_revision,'interactionId',i.id,'eventId',null,'action','unchanged');
  else
   insert into public.interactions as target(tenant_id,source_connector_id,source_type,source_table,source_id,source_external_id,interaction_type,direction,occurred_at,subject,summary,body_preview,
    from_address,from_name,to_addresses,cc_addresses,phone_from,phone_to,related_thread_id,processing_status,metadata)
   values(p_tenant,fields->>'source_connector_id',p_source,table_name,p_source_id,fields->>'source_external_id',fields->>'interaction_type',fields->>'direction',(fields->>'occurred_at')::timestamptz,
    fields->>'subject',fields->>'summary',fields->>'body_preview',fields->>'from_address',fields->>'from_name',array(select jsonb_array_elements_text(coalesce(fields->'to_addresses','[]'))),array(select jsonb_array_elements_text(coalesce(fields->'cc_addresses','[]'))),
    fields->>'phone_from',fields->>'phone_to',fields->>'related_thread_id','ready',jsonb_build_object('source_projection',jsonb_build_object('version','learn-interaction-projection/1','revision',p_revision,'fields',fields,'provider',provider,'coverage','unverified','accountBinding','unverified')))
   on conflict(tenant_id,source_table,source_id) do update set source_connector_id=excluded.source_connector_id,source_external_id=excluded.source_external_id,direction=excluded.direction,occurred_at=excluded.occurred_at,
    subject=excluded.subject,summary=excluded.summary,body_preview=excluded.body_preview,from_address=excluded.from_address,from_name=excluded.from_name,to_addresses=excluded.to_addresses,cc_addresses=excluded.cc_addresses,
    phone_from=excluded.phone_from,phone_to=excluded.phone_to,related_thread_id=excluded.related_thread_id,processing_status='ready',metadata=target.metadata||excluded.metadata
    where target.id=i.id and target.metadata->'source_projection'=i.metadata->'source_projection'
   returning id into interaction_id;
   if interaction_id is null then raise exception 'projection_owner_changed' using errcode='PT409';end if;
   if campaign is not null then
    -- The historical TEST schema lacks this optional Marketing column. Preserve
    -- campaign provenance in metadata there; set its native link where supported.
    update public.interactions set metadata=metadata||jsonb_build_object('origin_campaign_id',campaign) where tenant_id=p_tenant and id=interaction_id;
    if exists(select 1 from pg_attribute where attrelid='public.interactions'::regclass and attname='related_campaign_id' and not attisdropped) then
     if to_jsonb(i)->>'related_campaign_id' is not null and to_jsonb(i)->>'related_campaign_id'<>campaign::text then raise exception 'projection_campaign_conflict' using errcode='PT409';end if;
     execute 'update public.interactions set related_campaign_id=$1 where tenant_id=$2 and id=$3' using campaign,p_tenant,interaction_id;
    end if;
   end if;
   insert into public.platform_events as e(tenant_id,event_type,subject_type,subject_id,source,status,payload)
    values(p_tenant,'interaction.ready','interaction',interaction_id,'interactions-sync','pending',jsonb_build_object('projection_revision',p_revision,'source_kind',p_source,'source_id',p_source_id))
    on conflict(tenant_id,event_type,subject_id) where status='pending' do update set payload=e.payload||excluded.payload returning id into event_id;
   answer:=jsonb_build_object('version','learn-interaction-projection/1','state','committed','tenantId',p_tenant,'requestId',p_request,'sourceKind',p_source,'sourceId',p_source_id,'sourceRevision',p_revision,'interactionId',interaction_id,'eventId',event_id,'action',case when created then 'created' else 'updated' end);
  end if;
 end if;
 insert into public.learn_interaction_projection_receipts(request_id,tenant_id,source_kind,source_id,source_revision,receipt) values(p_request,p_tenant,p_source,p_source_id,p_revision,answer);
 return answer;
end$$;
revoke all on function public.learn_project_interaction(uuid,uuid,text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_project_interaction(uuid,uuid,text,uuid,text,text) to service_role;
-- Outstanding holds stay visible even when no new row is eligible this cycle.
create function public.learn_projection_review_count(p_tenant uuid,p_source text) returns integer
 language sql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
 with latest as (
  select distinct on(r.source_kind,r.source_id) r.* from public.learn_interaction_projection_receipts r
  where r.tenant_id=p_tenant and (p_source='all' or r.source_kind=p_source)
  order by r.source_kind,r.source_id,r.created_at desc,r.request_id desc
 ) select count(*)::integer from latest r where r.receipt->>'state'='review_required'
 and (case r.source_kind when 'phone' then exists(select 1 from public.phone_calls c left join public.interactions i
  on i.tenant_id=c.tenant_id and i.source_table='phone_calls' and i.source_id=c.id
  where c.tenant_id=p_tenant and c.id=r.source_id and r.source_revision=public.learn_projection_revision(public.learn_phone_source_fields(c),case when i.metadata?'phone_handoff' then public.phone_projection_version(p_tenant,c.id) else null end))
 else exists(select 1 from public.email_messages m where m.tenant_id=p_tenant and m.id=r.source_id and r.source_revision=public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id',''))) end)
$$;
revoke all on function public.learn_projection_review_count(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_projection_review_count(uuid,text) to service_role;


-- INPUT supabase/migrations/20261101320000_learn_projection_operator_review.sql
-- Audited operator reconciliation of retained-source projection holds.

set local lock_timeout='5s';set local statement_timeout='30s';
create table public.learn_projection_operator_reviews(
 id uuid primary key,tenant_id uuid not null references public.tenants(id),actor_id uuid not null references public.profiles(id),
 hold_id uuid not null references public.learn_interaction_projection_receipts(request_id),
 definition jsonb not null,receipt jsonb not null,previous_interaction jsonb,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_projection_operator_reviews enable row level security;
revoke all on public.learn_projection_operator_reviews from public,anon,authenticated,service_role;
create trigger learn_projection_operator_reviews_immutable before update or delete on public.learn_projection_operator_reviews
 for each row execute function public.learn_operator_input_immutable();

-- Only whitelisted canonical fields are returned, never raw provider metadata.
-- The full previous canonical row is retained privately when an action commits.
create function public.learn_projection_review_state(p_tenant uuid,p_hold uuid) returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare h public.learn_interaction_projection_receipts%rowtype;i public.interactions%rowtype;
 c public.phone_calls%rowtype;m public.email_messages%rowtype;fields jsonb;canonical jsonb;
 version text;revision text;reason text;allowed boolean;oversize boolean;fresh boolean;
begin
 select * into h from public.learn_interaction_projection_receipts where tenant_id=p_tenant and request_id=p_hold and receipt->>'state'='review_required';
 if not found then raise exception 'projection_review_unavailable' using errcode='42501';end if;
 if h.source_kind='phone' then
  select * into c from public.phone_calls where tenant_id=p_tenant and id=h.source_id;
  if not found then raise exception 'projection_review_source_unavailable' using errcode='PT409';end if;
  fields:=public.learn_phone_source_fields(c);version:=null;
 else
  select * into m from public.email_messages where tenant_id=p_tenant and id=h.source_id;
  if not found then raise exception 'projection_review_source_unavailable' using errcode='PT409';end if;
  fields:=public.learn_email_source_fields(m);version:=coalesce(to_jsonb(m)->>'origin_campaign_id','');
 end if;
 select * into i from public.interactions where tenant_id=p_tenant and source_table=case h.source_kind when 'phone' then 'phone_calls' else 'email_messages' end and source_id=h.source_id;
 select jsonb_object_agg(k,to_jsonb(i)->k) into canonical from jsonb_object_keys(fields) k;
 fresh:=h.source_revision=public.learn_projection_revision(fields,version);
 reason:=case when i.metadata?'phone_handoff' then 'authoritative_phone_owner'
  when not fresh then 'source_changed' when i.id is null then 'canonical_missing'
  when i.source_type is distinct from fields->>'source_type' or i.interaction_type is distinct from fields->>'interaction_type' then 'canonical_shape_unverified'
  -- Campaign publication may change a Marketing link not present in this
  -- communication comparison. Require its governed review instead.
  when h.source_kind='email' and version<>'' then 'campaign_review_required'
  when exists(select 1 from public.learn_interaction_projection_receipts r where r.tenant_id=p_tenant and r.source_kind=h.source_kind and r.source_id=h.source_id and (r.created_at,r.request_id)>(h.created_at,h.request_id)) then 'newer_processing_exists'
  else h.receipt->>'reason' end;
 oversize:=octet_length(jsonb_build_object('source',fields,'canonical',canonical)::text)>20000;
 allowed:=public.learn_capture_allowed(p_tenant,h.source_kind);
 revision:=encode(sha256(convert_to(jsonb_build_object('hold',p_hold,'source',fields,'version',version,'canonical',to_jsonb(i))::text,'UTF8')),'hex');
 return jsonb_build_object('version','learn-projection-review-detail/1','tenant_id',p_tenant,'hold_id',p_hold,'source_kind',h.source_kind,'source_id',h.source_id,'interaction_id',i.id,
  'revision',revision,'source_revision',public.learn_projection_revision(fields,version),'reason',reason,'capture_allowed',allowed,'can_apply',allowed and not oversize and reason in('legacy_projection_review','canonical_fields_changed'),
  'evidence_too_large',oversize,'source_fields',case when oversize then null else fields end,'canonical_fields',case when oversize then null else canonical end,'checked_at',clock_timestamp());
end$$;
revoke all on function public.learn_projection_review_state(uuid,uuid) from public,anon,authenticated,service_role;

create function public.learn_operator_projection_reviews(p_tenant uuid,p_after uuid default null) returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare h record;detail jsonb;rows jsonb:='[]';last_id uuid;more boolean:=false;n integer:=0;
begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 for h in with latest as (
  select distinct on(r.source_kind,r.source_id) r.* from public.learn_interaction_projection_receipts r where r.tenant_id=p_tenant
  order by r.source_kind,r.source_id,r.created_at desc,r.request_id desc
 ) select * from latest where receipt->>'state'='review_required' and (p_after is null or request_id>p_after) order by request_id limit 21 loop
  n:=n+1;if n>20 then more:=true;exit;end if;
  last_id:=h.request_id;
  rows:=rows||jsonb_build_array(jsonb_build_object('hold_id',h.request_id,'source_kind',h.source_kind,'source_id',h.source_id,'reason',h.receipt->>'reason','recorded_at',h.created_at));
 end loop;
 return jsonb_build_object('version','learn-projection-reviews/1','tenant_id',p_tenant,'rows',rows,'next_cursor',case when more then last_id else null end,'checked_at',clock_timestamp());
end$$;
revoke all on function public.learn_operator_projection_reviews(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_projection_reviews(uuid,uuid) to authenticated;
create function public.learn_operator_projection_review_detail(p_tenant uuid,p_hold uuid) returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 return public.learn_projection_review_state(p_tenant,p_hold);
end$$;
revoke all on function public.learn_operator_projection_review_detail(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_projection_review_detail(uuid,uuid) to authenticated;

create function public.learn_operator_projection_review(p_tenant uuid,p_actor uuid,p_request uuid,p_hold uuid,p_definition jsonb,p_mode text default 'apply') returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
#variable_conflict use_column
declare saved public.learn_projection_operator_reviews%rowtype;h public.learn_interaction_projection_receipts%rowtype;
 i public.interactions%rowtype;detail jsonb;answer jsonb;published jsonb;previous jsonb;
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_hold is null or p_mode is null or p_mode not in('apply','check','cancel')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>4000
  or not p_definition?&array['action','revision','reason'] or p_definition-array['action','revision','reason']<>'{}'::jsonb
  or p_definition->>'action' is distinct from 'apply_source' or coalesce(p_definition->>'revision','')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
 then raise exception 'projection_review_request_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-projection-review:'||p_request::text,0));
 select * into saved from public.learn_projection_operator_reviews where id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.actor_id<>p_actor or saved.hold_id<>p_hold or saved.definition<>p_definition then raise exception 'projection_review_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 select * into h from public.learn_interaction_projection_receipts where tenant_id=p_tenant and request_id=p_hold and receipt->>'state'='review_required';
 if not found then raise exception 'projection_review_unavailable' using errcode='42501';end if;
 answer:=jsonb_build_object('version','learn-projection-review-receipt/1','tenant_id',p_tenant,'request_id',p_request,'hold_id',p_hold);
 if p_mode='check' then return answer||jsonb_build_object('state','pending');end if;
 if p_mode='cancel' then answer:=answer||jsonb_build_object('state','cancelled');
 else
  perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
  perform pg_advisory_xact_lock(hashtextextended('learn-project:'||p_tenant::text||':'||h.source_kind||':'||h.source_id::text,0));
  -- Match the publisher's source -> canonical -> event lock order.
  if h.source_kind='phone' then perform 1 from public.phone_calls where tenant_id=p_tenant and id=h.source_id for update;
  else perform 1 from public.email_messages where tenant_id=p_tenant and id=h.source_id for update;end if;
  select * into i from public.interactions where tenant_id=p_tenant and source_table=case h.source_kind when 'phone' then 'phone_calls' else 'email_messages' end and source_id=h.source_id for update;
  detail:=public.learn_projection_review_state(p_tenant,p_hold);
  if detail->>'revision' is distinct from p_definition->>'revision' then raise exception 'projection_review_changed' using errcode='PT409';end if;
  if detail->'can_apply' is distinct from 'true'::jsonb then raise exception 'projection_review_not_applicable' using errcode='PT409';end if;
  previous:=to_jsonb(i);
  -- Explicit human consent to use the displayed retained source values. Stamp
  -- current canonical ownership only inside this transaction, then let the
  -- authoritative projector validate and publish its actual source fields.
  update public.interactions set metadata=metadata||jsonb_build_object('source_projection',jsonb_build_object('version','learn-interaction-projection/1','revision',repeat('0',64),'fields',detail->'canonical_fields','operatorReviewId',p_request))
   where tenant_id=p_tenant and id=i.id;
  published:=public.learn_project_interaction(p_tenant,p_request,h.source_kind,h.source_id,detail->>'source_revision','publish');
  if published->>'state' is distinct from 'committed' or published->>'action' is distinct from 'updated' or published->>'interactionId' is distinct from i.id::text
  then raise exception 'projection_review_publication_unconfirmed' using errcode='PT409';end if;
  update public.interactions set metadata=metadata||jsonb_build_object('projection_review',jsonb_build_object('requestId',p_request,'actorId',p_actor,'holdId',p_hold)) where tenant_id=p_tenant and id=i.id;
  answer:=answer||jsonb_build_object('state','recorded','interaction_id',i.id,'event_id',published->'eventId','card_processing','pending');
 end if;
 insert into public.learn_projection_operator_reviews(id,tenant_id,actor_id,hold_id,definition,receipt,previous_interaction)
  values(p_request,p_tenant,p_actor,p_hold,p_definition,answer,previous);
 return answer;
end$$;
revoke all on function public.learn_operator_projection_review(uuid,uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_projection_review(uuid,uuid,uuid,uuid,jsonb,text) to authenticated;

-- INPUT supabase/migrations/20261101330000_learn_identity_operator_review.sql
-- Operator resolution of held customer attribution. All publication and audit
-- changes commit together; no new grants, provider calls or source rewrites.

set local lock_timeout='5s';set local statement_timeout='30s';
create table public.learn_identity_operator_reviews(
 id uuid primary key,tenant_id uuid not null references public.tenants(id),actor_id uuid not null references public.profiles(id),
 interaction_id uuid not null references public.interactions(id),definition jsonb not null,receipt jsonb not null,
 previous_interaction jsonb,reviewed_person jsonb,reviewed_company jsonb,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_identity_operator_reviews enable row level security;
revoke all on public.learn_identity_operator_reviews from public,anon,authenticated,service_role;
create trigger learn_identity_operator_reviews_immutable before update or delete on public.learn_identity_operator_reviews
 for each row execute function public.learn_operator_input_immutable();

create function public.learn_identity_deliver_internal(p_tenant uuid,p_request uuid,p_interaction uuid,p_revision text,p_phase text,p_reviewed_person uuid)
 returns jsonb language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
#variable_conflict use_column
<<delivery>>
declare
 i public.interactions%rowtype;p public.people%rowtype;c public.companies%rowtype;card public.customer_cards%rowtype;
 saved public.learn_identity_delivery_receipts%rowtype;event public.platform_events%rowtype;
 email text;phone text;contact_name text;domain text;person_id uuid;company_id uuid;email_id uuid;phone_id uuid;
 matches integer;created_person boolean:=false;created_company boolean:=false;new_card boolean:=false;
 reason text;confidence numeric:=0;evidence jsonb:='[]';company_evidence jsonb:='[]';person_level text:='possible';
 answer jsonb;suggestions integer:=0;recs integer:=0;consumed integer:=0;affected integer:=0;
 interaction_count integer;today_count integer;open_rec_score integer;priority_score integer;priority_bucket text;
 start_today timestamptz:=date_trunc('day',statement_timestamp());activity timestamptz;has_phone_receipt boolean;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'identity_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_request is null or p_interaction is null or coalesce(p_revision,'') !~ '^[a-f0-9]{64}$'
 or p_phase is null or p_phase not in('publish','inspect') then raise exception 'identity_request_invalid' using errcode='22023';end if;
 select * into saved from public.learn_identity_delivery_receipts where request_id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.interaction_id<>p_interaction or saved.source_revision<>p_revision then raise exception 'identity_receipt_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 if p_phase='inspect' then raise exception 'identity_receipt_missing' using errcode='PT409';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 -- Serialise this engine's provisional identity creation within the tenant.
 perform pg_advisory_xact_lock(hashtextextended('learn-identity:'||p_tenant::text,0));
 select * into saved from public.learn_identity_delivery_receipts where request_id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.interaction_id<>p_interaction or saved.source_revision<>p_revision then raise exception 'identity_receipt_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'identity_tenant_inactive' using errcode='PT409';end if;
 select * into i from public.interactions where tenant_id=p_tenant and id=p_interaction for update;
 if not found or public.learn_identity_revision(i)<>p_revision or i.processing_status not in('pending','ready','identity_review')
 then raise exception 'identity_source_changed' using errcode='PT409';end if;
 select * into event from public.platform_events where tenant_id=p_tenant and event_type='interaction.ready' and subject_type='interaction'
 and subject_id=i.id and status='pending' for update;
 has_phone_receipt:=i.metadata->'phone_handoff'->>'version'='learn-phone-handoff/1';
 if coalesce(has_phone_receipt,false) and (event.id is null or event.payload->>'source_fingerprint' is distinct from i.metadata->'phone_handoff'->>'sourceFingerprint')
 then raise exception 'identity_event_changed' using errcode='PT409';end if;
 if i.direction='internal' then reason:='internal_interaction';
 elsif i.direction not in('inbound','outbound') or i.direction is null then reason:='direction_unverified';end if;
 email:=nullif(lower(btrim(case when i.direction='outbound' then i.to_addresses[1] else i.from_address end)),'');
 phone:=nullif(btrim(case when i.direction='outbound' then i.phone_to else i.phone_from end),'');
 contact_name:=case when i.direction='inbound' then nullif(btrim(i.from_name),'') else null end;
 -- Treat provider text as data. No dynamic filters or SQL are built from identifiers.
 if email is not null and email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then reason:=coalesce(reason,'email_unverified');end if;
 if phone is not null and phone !~ '^\+?[0-9][0-9 ()-]{4,30}$' then reason:=coalesce(reason,'phone_unverified');end if;
 if email is null and phone is null then reason:=coalesce(reason,'contact_missing');end if;
 if reason is null and p_reviewed_person is not null then
  select * into p from public.people where tenant_id=p_tenant and id=p_reviewed_person for update;
  if not found then raise exception 'identity_review_person_unavailable' using errcode='PT409';end if;
  person_id:=p.id;company_id:=p.company_id;
  contact_name:=coalesce(p.display_name,p.primary_email,p.primary_phone);
  if company_id is not null then
   select * into c from public.companies where tenant_id=p_tenant and id=company_id for share;
   if not found then raise exception 'identity_review_company_unavailable' using errcode='PT409';end if;
  end if;
  confidence:=1;person_level:='confirmed';
  evidence:=jsonb_build_array(jsonb_build_object('source','operator_attribution','detail','An authorised operator attributed this communication to the selected contact; this does not verify the contact globally','requestId',p_request,'weight',1));
 else
 if reason is null and email is not null then
  select count(*),min(x.id::text)::uuid into matches,email_id from public.people x where x.tenant_id=p_tenant and lower(btrim(x.primary_email))=email;
  if matches>1 then reason:='person_ambiguous';end if;
 end if;
 if reason is null and phone is not null then
  select count(*),min(x.id::text)::uuid into matches,phone_id from public.people x where x.tenant_id=p_tenant and btrim(x.primary_phone)=phone;
  if matches>1 then reason:='person_ambiguous';end if;
 end if;
 if reason is null and email_id is not null and phone_id is not null and email_id<>phone_id then reason:='person_conflict';end if;
 if reason is null then
  person_id:=coalesce(email_id,phone_id);
  if i.related_person_id is not null then
   perform 1 from public.people where tenant_id=p_tenant and id=i.related_person_id;
   if not found then reason:='person_link_invalid';
   elsif person_id is not null and person_id<>i.related_person_id then reason:='person_link_conflict';
   else person_id:=i.related_person_id;end if;
  end if;
 end if;
 if reason is null and person_id is not null then
  select * into p from public.people where tenant_id=p_tenant and id=person_id for update;
  if not found then raise exception 'identity_source_changed' using errcode='PT409';end if;
  confidence:=case when email_id=person_id then 0.95 when phone_id=person_id then 0.92 else 0 end;
  person_level:=case when confidence>=0.9 then 'confirmed' else 'possible' end;
  evidence:=jsonb_build_array(jsonb_build_object('source',case when email_id=person_id then 'email' when phone_id=person_id then 'phone' else 'existing_interaction_link' end,
   'detail',case when confidence>=0.9 then 'Unique exact contact match within this tenant' else 'Preserved existing interaction attribution; contact match unverified' end,'weight',confidence));
  company_id:=coalesce(i.related_company_id,p.company_id);
  if i.related_company_id is not null and p.company_id is not null and i.related_company_id<>p.company_id then reason:='company_link_conflict';end if;
 else company_id:=i.related_company_id;end if;
 if reason is null and company_id is not null then
  select * into c from public.companies where tenant_id=p_tenant and id=company_id for share;
  if not found then reason:='company_link_invalid';end if;
 end if;
 if reason is null and company_id is null and email is not null then
  domain:=split_part(email,'@',2);
  if domain<>all(array['gmail.com','googlemail.com','outlook.com','hotmail.com','hotmail.co.uk','live.com','yahoo.com','yahoo.co.uk','icloud.com','me.com','aol.com','btinternet.com','sky.com','msn.com','protonmail.com','gmx.com']) then
   select count(*),min(x.id::text)::uuid into matches,company_id from public.companies x where x.tenant_id=p_tenant and lower(btrim(x.domain))=domain;
   if matches>1 then reason:='company_ambiguous';
   elsif company_id is not null then
    select * into c from public.companies where tenant_id=p_tenant and id=company_id for share;
    company_evidence:=jsonb_build_array(jsonb_build_object('source','email_domain','detail','Unique company domain match; provisional attribution','weight',0.85));
   end if;
  else domain:=null;end if;
 end if;
 if reason is null and exists(select 1 from public.interaction_match_suggestions s where s.tenant_id=p_tenant and s.interaction_id=i.id and s.status='rejected' and ((s.target_type='person' and s.target_id=person_id) or (s.target_type='company' and s.target_id=company_id))) then reason:='reviewed_match_rejected';end if;
 end if;
 -- Never consume a signal or invent a card when its external identity needs review.
 if reason is not null then
  update public.interactions set processing_status='identity_review',metadata=metadata||jsonb_build_object('identity_delivery',jsonb_build_object('state','review_required','reason',reason,'requestId',p_request)) where id=i.id and tenant_id=p_tenant;
  get diagnostics affected=row_count;if affected<>1 then raise exception 'identity_source_changed' using errcode='PT409';end if;
  answer:=jsonb_build_object('version','learn-identity-delivery/1','state','review_required','tenantId',p_tenant,'requestId',p_request,'interactionId',i.id,'sourceRevision',p_revision,'reason',reason,'cardId',null,'personCreated',false,'companyCreated',false,'cardEnriched',false,'recommendations',0,'suggestions',0,'eventsConsumed',0);
 else
  if company_id is null and domain is not null then
   insert into public.companies(tenant_id,name,domain,verified,created_source) values(p_tenant,domain,domain,false,'interaction') returning id into company_id;
   created_company:=true;
  end if;
  if person_id is null then
   insert into public.people(tenant_id,primary_email,primary_phone,display_name,company_id,verified,created_source,metadata)
    values(p_tenant,email,phone,contact_name,company_id,false,'interaction',jsonb_build_object('origin_interaction',i.id)) returning * into p;
   person_id:=p.id;created_person:=true;confidence:=0;
   evidence:=jsonb_build_array(jsonb_build_object('source','interaction','detail','Provisional contact created from source identifier; identity review required','weight',0));
  end if;
  -- Preserve reviewed suggestions instead of resetting accepted/rejected decisions.
  if not created_person then
   insert into public.interaction_match_suggestions as s(tenant_id,interaction_id,target_type,target_id,match_level,confidence,evidence,explanation,recommended_action,status,created_by)
    values(p_tenant,i.id,'person',person_id,person_level,confidence,evidence,'Contact evidence retained with the interaction','Review contact attribution','pending','system')
    on conflict(tenant_id,interaction_id,target_type,target_id) do update set confidence=excluded.confidence,evidence=excluded.evidence,explanation=excluded.explanation where s.status='pending';
   get diagnostics suggestions=row_count;
  end if;
  if company_id is not null and company_evidence<>'[]'::jsonb then
   insert into public.interaction_match_suggestions as s(tenant_id,interaction_id,target_type,target_id,match_level,confidence,evidence,explanation,status,created_by)
    values(p_tenant,i.id,'company',company_id,'likely',0.85,company_evidence,'Provisional attribution from company domain','pending','system')
    on conflict(tenant_id,interaction_id,target_type,target_id) do update set evidence=excluded.evidence where s.status='pending';
   get diagnostics affected=row_count;suggestions:=suggestions+affected;
  end if;
  -- Link inside this transaction so aggregate counts include this interaction.
  update public.interactions set related_person_id=person_id,related_company_id=company_id where tenant_id=p_tenant and id=i.id;
  get diagnostics affected=row_count;if affected<>1 then raise exception 'identity_source_changed' using errcode='PT409';end if;
  select count(*),count(*) filter(where occurred_at>=start_today and occurred_at<start_today+interval '1 day') into interaction_count,today_count
   from public.interactions where tenant_id=p_tenant and related_person_id=person_id;
  select * into card from public.customer_cards x where x.tenant_id=p_tenant and x.person_id=delivery.person_id for update;
  if not found then
   insert into public.customer_cards(tenant_id,person_id,company_id,title,summary,latest_activity_at,confidence)
    values(p_tenant,person_id,company_id,coalesce(contact_name,p.display_name,email,phone),coalesce(i.summary,i.body_preview),i.occurred_at,confidence)
    on conflict(tenant_id,person_id) where person_id is not null do nothing returning * into card;
   new_card:=found;
   if not new_card then select * into card from public.customer_cards x where x.tenant_id=p_tenant and x.person_id=delivery.person_id for update;end if;
  end if;
  if card.id is null then raise exception 'identity_card_unconfirmed' using errcode='PT409';end if;
  if today_count>=2 then
   insert into public.recommendations(tenant_id,type,title,detail,severity,status,card_id,interaction_id,person_id,company_id,evidence,recommended_action,created_by)
    values(p_tenant,'repeat_contact_today','Repeated contact today','Multiple interactions recorded during the current UTC day; review response needs.','high','open',card.id,i.id,person_id,company_id,
     jsonb_build_array(jsonb_build_object('source','interactions','count',today_count,'periodStart',start_today,'timezone','UTC')),'Review and respond','system')
    on conflict(tenant_id,card_id,type) where status='open' and card_id is not null do nothing;
   get diagnostics affected=row_count;recs:=recs+affected;
  end if;
  if created_person then
   insert into public.recommendations(tenant_id,type,title,detail,severity,status,card_id,interaction_id,person_id,company_id,evidence,recommended_action,created_by)
    values(p_tenant,'review_new_contact','New contact — confirm identity','Provisional contact from a source interaction; confirm or link it.','info','open',card.id,i.id,person_id,company_id,evidence,'Review and confirm the contact','system')
    on conflict(tenant_id,card_id,type) where status='open' and card_id is not null do nothing;
   get diagnostics affected=row_count;recs:=recs+affected;
  end if;
  select coalesce(sum(case severity when 'critical' then 30 when 'high' then 20 when 'medium' then 10 when 'low' then 5 else 2 end),0) into open_rec_score
   from public.recommendations where tenant_id=p_tenant and card_id=card.id and status='open';
  priority_score:=least(100,20+least(30,interaction_count*5)+open_rec_score+case when i.sentiment='negative' then 20 else 0 end+case when today_count>=2 then 15 else 0 end);
  priority_bucket:=case when priority_score>=75 then 'critical' when priority_score>=50 then 'high' when priority_score>=25 then 'medium' else 'low' end;
  activity:=greatest(card.latest_activity_at,i.occurred_at);
  -- Read locks and manual values at commit time, not from a stale client snapshot.
  update public.customer_cards x set
   company_id=case when 'company_id'=any(card.locked_fields) then x.company_id else delivery.company_id end,
   title=case when 'title'=any(card.locked_fields) then x.title else coalesce(contact_name,p.display_name,email,phone,x.title) end,
   summary=case when 'summary'=any(card.locked_fields) or card.latest_activity_at>i.occurred_at then x.summary else coalesce(i.summary,i.body_preview,x.summary) end,
   latest_activity_at=case when 'latest_activity_at'=any(card.locked_fields) then x.latest_activity_at else activity end,
   confidence=case when 'confidence'=any(card.locked_fields) then x.confidence else delivery.confidence end,
   priority=case when card.locked_fields&&array['priority','priority_score','priority_inputs'] then x.priority else priority_bucket end,
   priority_score=case when card.locked_fields&&array['priority','priority_score','priority_inputs'] then x.priority_score else delivery.priority_score end,
   priority_inputs=case when card.locked_fields&&array['priority','priority_score','priority_inputs'] then x.priority_inputs else jsonb_build_object('version','identity-priority/2','interaction_count',interaction_count,'open_rec_score',open_rec_score,'negative_sentiment',i.sentiment='negative','repeat_today',today_count>=2,'periodStart',start_today,'timezone','UTC','sourceInteractionId',i.id,'sourceRevision',p_revision) end
   where x.tenant_id=p_tenant and x.id=card.id;
  get diagnostics affected=row_count;if affected<>1 then raise exception 'identity_card_unconfirmed' using errcode='PT409';end if;
  if event.id is not null then
   update public.platform_events set status='consumed',consumed_at=clock_timestamp(),metadata=metadata||jsonb_build_object('identity_delivery_request',p_request,'identity_source_revision',p_revision)
    where tenant_id=p_tenant and id=event.id and status='pending';
   get diagnostics consumed=row_count;if consumed<>1 then raise exception 'identity_event_changed' using errcode='PT409';end if;
  end if;
  update public.interactions set processing_status='enriched',metadata=metadata||jsonb_build_object('identity_delivery',jsonb_build_object('state','committed','requestId',p_request,'sourceRevision',p_revision,'cardId',card.id)) where tenant_id=p_tenant and id=i.id;
  get diagnostics affected=row_count;if affected<>1 then raise exception 'identity_source_changed' using errcode='PT409';end if;
  answer:=jsonb_build_object('version','learn-identity-delivery/1','state','committed','tenantId',p_tenant,'requestId',p_request,'interactionId',i.id,'sourceRevision',p_revision,'cardId',card.id,'personCreated',created_person,'companyCreated',created_company,'cardEnriched',true,'recommendations',recs,'suggestions',suggestions,'eventsConsumed',consumed);
 end if;
 insert into public.learn_identity_delivery_receipts(request_id,tenant_id,interaction_id,source_revision,receipt) values(p_request,p_tenant,i.id,p_revision,answer);
 return answer;
end$$;

revoke all on function public.learn_identity_deliver_internal(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
-- Preserve the service API and its automatic matching behaviour. Only the
-- governed operator RPC may provide a reviewed person to the private engine.
create or replace function public.learn_identity_deliver(p_tenant uuid,p_request uuid,p_interaction uuid,p_revision text,p_phase text)
 returns jsonb language sql security definer set search_path=pg_catalog set timezone='UTC' as $$
 select public.learn_identity_deliver_internal(p_tenant,p_request,p_interaction,p_revision,p_phase,null)
$$;

create function public.learn_identity_review_state(p_tenant uuid,p_interaction uuid,p_person uuid) returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare i public.interactions%rowtype;p public.people%rowtype;c public.companies%rowtype;reason text;revision text;rejected jsonb;source jsonb;
begin
 select * into i from public.interactions where tenant_id=p_tenant and id=p_interaction;
 if not found then raise exception 'identity_review_unavailable' using errcode='42501';end if;
 select * into p from public.people where tenant_id=p_tenant and id=p_person;
 if not found then raise exception 'identity_review_person_unavailable' using errcode='42501';end if;
 if p.company_id is not null then select * into c from public.companies where tenant_id=p_tenant and id=p.company_id;end if;
 select coalesce(jsonb_agg(jsonb_build_object('target_type',s.target_type,'target_id',s.target_id,'status',s.status,'explanation',left(s.explanation,1000)) order by s.target_type,s.target_id),'[]') into rejected
 from public.interaction_match_suggestions s where s.tenant_id=p_tenant and s.interaction_id=i.id and s.status='rejected' and ((s.target_type='person' and s.target_id=p.id) or(s.target_type='company' and s.target_id=c.id));
 reason:=case when i.processing_status<>'identity_review' or i.metadata->'identity_delivery'->>'state' is distinct from 'review_required' then 'hold_changed'
  when i.direction not in('inbound','outbound') or i.direction is null then 'direction_needs_source_review'
  when p.company_id is not null and c.id is null then 'company_link_invalid'
  when exists(select 1 from public.learn_identity_delivery_receipts r where r.tenant_id=p_tenant and r.interaction_id=i.id and r.receipt->>'state'='committed') then 'previous_delivery_needs_reconciliation'
  when i.related_person_id is not null and i.related_person_id<>p.id and exists(select 1 from public.customer_cards k where k.tenant_id=p_tenant and k.person_id=i.related_person_id) then 'previous_card_needs_reconciliation'
  when coalesce(i.metadata->'identity_delivery'->>'reason','') not in('person_ambiguous','person_conflict','person_link_invalid','person_link_conflict','company_link_conflict','company_link_invalid','company_ambiguous','reviewed_match_rejected') then 'source_needs_review'
  else null end;
 source:=jsonb_build_object('source_type',i.source_type,'direction',i.direction,'occurred_at',i.occurred_at,'subject',left(i.subject,1000),'preview',left(coalesce(i.summary,i.body_preview),2000),'from_address',left(i.from_address,500),'to_address',left(i.to_addresses[1],500),'phone_from',left(i.phone_from,100),'phone_to',left(i.phone_to,100),'related_person_id',i.related_person_id,'related_company_id',i.related_company_id);
 revision:=encode(sha256(convert_to(jsonb_build_object('interaction',to_jsonb(i),'person',to_jsonb(p),'company',to_jsonb(c),'rejected',rejected)::text,'UTF8')),'hex');
 return jsonb_build_object('version','learn-identity-review-detail/1','tenant_id',p_tenant,'interaction_id',i.id,'person_id',p.id,'revision',revision,'can_apply',reason is null,'blocked_reason',reason,'hold_reason',i.metadata->'identity_delivery'->>'reason','source',source,
  'person',jsonb_build_object('name',left(p.display_name,500),'email',left(p.primary_email,500),'phone',left(p.primary_phone,100),'verified',p.verified),
  'company',case when c.id is null then null else jsonb_build_object('id',c.id,'name',left(c.name,500),'domain',left(c.domain,500)) end,
  'rejected_matches',rejected,'checked_at',clock_timestamp());
end$$;
revoke all on function public.learn_identity_review_state(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function public.learn_operator_identity_reviews(p_tenant uuid,p_after uuid default null) returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare rows jsonb:='[]';i record;n integer:=0;last_id uuid;more boolean:=false;
begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 for i in select * from public.interactions where tenant_id=p_tenant and processing_status='identity_review' and (p_after is null or id>p_after) order by id limit 21 loop
  n:=n+1;if n>20 then more:=true;exit;end if;last_id:=i.id;
  rows:=rows||jsonb_build_array(jsonb_build_object('interaction_id',i.id,'source_type',i.source_type,'subject',left(i.subject,200),'occurred_at',i.occurred_at,'reason',coalesce(i.metadata->'identity_delivery'->>'reason','source_needs_review')));
 end loop;
 return jsonb_build_object('version','learn-identity-reviews/1','tenant_id',p_tenant,'rows',rows,'next_cursor',case when more then last_id else null end,'checked_at',clock_timestamp());
end$$;
revoke all on function public.learn_operator_identity_reviews(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_identity_reviews(uuid,uuid) to authenticated;
create function public.learn_operator_identity_people(p_tenant uuid,p_search text,p_after uuid default null) returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare rows jsonb:='[]';p record;n integer:=0;last_id uuid;more boolean:=false;
begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 if p_search is null or length(btrim(p_search)) not between 2 and 100 then raise exception 'identity_search_invalid' using errcode='22023';end if;
 for p in select * from public.people where tenant_id=p_tenant and (p_after is null or id>p_after)
  and (strpos(lower(coalesce(display_name,'')),lower(btrim(p_search)))>0 or strpos(lower(coalesce(primary_email,'')),lower(btrim(p_search)))>0 or strpos(coalesce(primary_phone,''),btrim(p_search))>0)
  order by id limit 21 loop
  n:=n+1;if n>20 then more:=true;exit;end if;last_id:=p.id;
  rows:=rows||jsonb_build_array(jsonb_build_object('id',p.id,'name',left(p.display_name,500),'email',left(p.primary_email,500),'phone',left(p.primary_phone,100)));
 end loop;
 return jsonb_build_object('version','learn-identity-people/1','tenant_id',p_tenant,'search',p_search,'rows',rows,'next_cursor',case when more then last_id else null end);
end$$;
revoke all on function public.learn_operator_identity_people(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_identity_people(uuid,text,uuid) to authenticated;
create function public.learn_operator_identity_review_detail(p_tenant uuid,p_interaction uuid,p_person uuid) returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 return public.learn_identity_review_state(p_tenant,p_interaction,p_person);
end$$;
revoke all on function public.learn_operator_identity_review_detail(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_identity_review_detail(uuid,uuid,uuid) to authenticated;
create function public.learn_operator_identity_review(p_tenant uuid,p_actor uuid,p_request uuid,p_interaction uuid,p_definition jsonb,p_mode text default 'apply') returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
#variable_conflict use_column
declare saved public.learn_identity_operator_reviews%rowtype;i public.interactions%rowtype;p public.people%rowtype;c public.companies%rowtype;
 detail jsonb;answer jsonb;published jsonb;previous jsonb;person_id uuid;
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_interaction is null or p_mode is null or p_mode not in('apply','check','cancel')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>4000
  or not p_definition?&array['action','revision','reason','person_id'] or p_definition-array['action','revision','reason','person_id']<>'{}'::jsonb
  or p_definition->>'action' is distinct from 'attribute_contact' or coalesce(p_definition->>'revision','')!~'^[a-f0-9]{64}$'
  or coalesce(p_definition->>'person_id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
 then raise exception 'identity_review_request_invalid' using errcode='22023';end if;
 person_id:=(p_definition->>'person_id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('learn-identity-review:'||p_request::text,0));
 select * into saved from public.learn_identity_operator_reviews where id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.actor_id<>p_actor or saved.interaction_id<>p_interaction or saved.definition<>p_definition then raise exception 'identity_review_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 perform 1 from public.interactions where tenant_id=p_tenant and id=p_interaction;
 if not found then raise exception 'identity_review_unavailable' using errcode='42501';end if;
 answer:=jsonb_build_object('version','learn-identity-review-receipt/1','tenant_id',p_tenant,'request_id',p_request,'interaction_id',p_interaction,'person_id',person_id);
 if p_mode='check' then return answer||jsonb_build_object('state','pending');end if;
 if p_mode='cancel' then answer:=answer||jsonb_build_object('state','cancelled');
 else
  perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
  perform pg_advisory_xact_lock(hashtextextended('learn-identity:'||p_tenant::text,0));
  select * into i from public.interactions where tenant_id=p_tenant and id=p_interaction for update;
  -- Match the delivery engine's interaction -> event -> person -> company order.
  perform 1 from public.platform_events where tenant_id=p_tenant and event_type='interaction.ready' and subject_type='interaction' and subject_id=i.id and status='pending' for update;
  select * into p from public.people where tenant_id=p_tenant and id=person_id for update;
  if p.company_id is not null then select * into c from public.companies where tenant_id=p_tenant and id=p.company_id for share;end if;
  perform 1 from public.interaction_match_suggestions where tenant_id=p_tenant and interaction_id=i.id for update;
  detail:=public.learn_identity_review_state(p_tenant,p_interaction,person_id);
  if detail->>'revision' is distinct from p_definition->>'revision' then raise exception 'identity_review_changed' using errcode='PT409';end if;
  if detail->'can_apply' is distinct from 'true'::jsonb then raise exception 'identity_review_not_applicable' using errcode='PT409';end if;
  previous:=to_jsonb(i);
  published:=public.learn_identity_deliver_internal(p_tenant,p_request,i.id,public.learn_identity_revision(i),'publish',person_id);
  if published->>'state' is distinct from 'committed' or published->'cardEnriched' is distinct from 'true'::jsonb
   or published->>'interactionId' is distinct from i.id::text then raise exception 'identity_review_publication_unconfirmed' using errcode='PT409';end if;
  update public.interactions set metadata=metadata||jsonb_build_object('identity_review',jsonb_build_object('requestId',p_request,'actorId',p_actor,'personId',person_id)) where tenant_id=p_tenant and id=i.id;
  answer:=answer||jsonb_build_object('state','recorded','card_id',published->'cardId','card_processing','committed');
 end if;
 insert into public.learn_identity_operator_reviews(id,tenant_id,actor_id,interaction_id,definition,receipt,previous_interaction,reviewed_person,reviewed_company)
  values(p_request,p_tenant,p_actor,p_interaction,p_definition,answer,previous,case when previous is null then null else to_jsonb(p) end,case when c.id is null then null else to_jsonb(c) end);
 return answer;
end$$;
revoke all on function public.learn_operator_identity_review(uuid,uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_identity_review(uuid,uuid,uuid,uuid,jsonb,text) to authenticated;

-- INPUT supabase/migrations/20261101340000_learn_processing_queue.sql
-- Durable publication ownership and atomic completion/continuation for the two
-- retained-input processors. Does not enable capture or change other job types.

set local lock_timeout='5s';set local statement_timeout='30s';
create table public.learn_processing_publications(
 request_id uuid primary key,tenant_id uuid not null references public.tenants(id),job_id uuid not null references public.platform_jobs(id),
 attempt integer not null,worker text not null,source_kind text not null,source_id uuid not null,source_revision text not null,
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index learn_processing_publications_job on public.learn_processing_publications(job_id,attempt);
create table public.learn_processing_settlements(
 request_id uuid primary key,tenant_id uuid not null references public.tenants(id),job_id uuid not null references public.platform_jobs(id),
 attempt integer not null,worker text not null,definition jsonb not null,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp(),unique(job_id,attempt)
);
alter table public.learn_processing_publications enable row level security;
alter table public.learn_processing_settlements enable row level security;
revoke all on public.learn_processing_publications,public.learn_processing_settlements from public,anon,authenticated,service_role;
create trigger learn_processing_publications_immutable before update or delete on public.learn_processing_publications for each row execute function public.learn_operator_input_immutable();
create trigger learn_processing_settlements_immutable before update or delete on public.learn_processing_settlements for each row execute function public.learn_operator_input_immutable();

create function public.learn_identity_review_count(p_tenant uuid) returns integer
 language sql stable security definer set search_path=pg_catalog as $$
 select count(*)::integer from public.interactions where tenant_id=p_tenant and processing_status='identity_review'
$$;
revoke all on function public.learn_identity_review_count(uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_identity_review_count(uuid) to service_role;

create function public.learn_processing_publish(p_tenant uuid,p_job uuid,p_worker text,p_attempt integer,p_request uuid,p_source text,p_source_id uuid,p_revision text,p_phase text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare j public.platform_jobs%rowtype;s public.learn_processing_publications%rowtype;r jsonb;source text;
begin
 if current_setting('transaction_isolation')<>'read committed' or p_request is null or p_job is null or p_tenant is null or p_source_id is null
  or p_worker is null or length(p_worker) not between 1 and 200 or p_attempt is null or p_attempt<1
  or p_source is null or p_source not in('identity','phone','email') or coalesce(p_revision,'')!~'^[a-f0-9]{64}$' or p_phase is null or p_phase not in('publish','inspect')
 then raise exception 'processing_request_invalid' using errcode='22023';end if;
 -- Capture gate precedes job/source locks throughout this path.
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 perform pg_advisory_xact_lock(hashtextextended('learn-processing-publication:'||p_request::text,0));
 select * into s from public.learn_processing_publications where request_id=p_request;
 if found then
  if s.tenant_id<>p_tenant or s.job_id<>p_job or s.attempt<>p_attempt or s.worker<>p_worker or s.source_kind<>p_source or s.source_id<>p_source_id or s.source_revision<>p_revision
  then raise exception 'processing_receipt_conflict' using errcode='PT409';end if;
  return s.receipt;
 end if;
 if p_phase='inspect' then raise exception 'processing_receipt_missing' using errcode='PT409';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for share;
 if not found or j.status<>'running' or j.claimed_by is distinct from p_worker or j.attempt_count<>p_attempt or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp()
  or j.job_type not in('identity.resolve','interactions.sync') then raise exception 'processing_claim_lost' using errcode='PT409';end if;
 if j.job_type='identity.resolve' then
  if p_source<>'identity' then raise exception 'processing_source_mismatch' using errcode='PT409';end if;
  r:=public.learn_identity_deliver(p_tenant,p_request,p_source_id,p_revision,'publish');
 else
  source:=coalesce(j.payload->>'source','all');
  if p_source not in('phone','email') or source not in('phone','email','all') or (source<>'all' and source<>p_source) then raise exception 'processing_source_mismatch' using errcode='PT409';end if;
  r:=public.learn_project_interaction(p_tenant,p_request,p_source,p_source_id,p_revision,'publish');
 end if;
 -- Holding the job row prevents reclaim during publication; refuse the commit
 -- if its time lease ran out while the source/card transaction was working.
 if j.lease_expires_at<=clock_timestamp() then raise exception 'processing_claim_lost' using errcode='PT409';end if;
 insert into public.learn_processing_publications(request_id,tenant_id,job_id,attempt,worker,source_kind,source_id,source_revision,receipt)
 values(p_request,p_tenant,p_job,p_attempt,p_worker,p_source,p_source_id,p_revision,r);
 return r;
end$$;
revoke all on function public.learn_processing_publish(uuid,uuid,text,integer,uuid,text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_processing_publish(uuid,uuid,text,integer,uuid,text,uuid,text,text) to service_role;

create function public.learn_processing_settle(p_tenant uuid,p_job uuid,p_worker text,p_attempt integer,p_request uuid,p_definition jsonb,p_phase text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
#variable_conflict use_column
declare j public.platform_jobs%rowtype;s public.learn_processing_settlements%rowtype;child public.platform_jobs%rowtype;
 success boolean;continued boolean;retry boolean;outcome text;error_code text;records integer;actual integer;delay integer;limit_n integer;source text;key text;payload jsonb;r jsonb;
 allowed_keys text[];entry record;at_time timestamptz;
begin
 if current_setting('transaction_isolation')<>'read committed' or p_request is null or p_job is null or p_tenant is null
  or p_worker is null or length(p_worker) not between 1 and 200 or p_attempt is null or p_attempt<1 or p_phase is null or p_phase not in('settle','inspect')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>8000
  or not p_definition?&array['success','records_processed','result','continue','retryable','error_code']
  or p_definition-array['success','records_processed','result','continue','retryable','error_code']<>'{}'::jsonb
  or jsonb_typeof(p_definition->'success') is distinct from 'boolean' or jsonb_typeof(p_definition->'continue') is distinct from 'boolean'
  or jsonb_typeof(p_definition->'retryable') is distinct from 'boolean' or jsonb_typeof(p_definition->'result') is distinct from 'object'
  or jsonb_typeof(p_definition->'records_processed') is distinct from 'number' or coalesce(p_definition->>'records_processed','')!~'^[0-9]{1,6}$'
  or (p_definition->'error_code'<>'null'::jsonb and (jsonb_typeof(p_definition->'error_code') is distinct from 'string' or coalesce(p_definition->>'error_code','')!~'^[a-z_]{1,80}$'))
 then raise exception 'processing_settlement_invalid' using errcode='22023';end if;
 success:=(p_definition->>'success')::boolean;continued:=(p_definition->>'continue')::boolean;records:=(p_definition->>'records_processed')::integer;error_code:=p_definition->>'error_code';
 if (success and (error_code is not null or (p_definition->>'retryable')::boolean)) or (not success and (error_code is null or continued))
  or (continued and (records=0 or p_definition->'result'->'continued' is distinct from 'true'::jsonb))
 then raise exception 'processing_settlement_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-processing-settle:'||p_job::text,0));
 select * into s from public.learn_processing_settlements where request_id=p_request;
 if found then
  if s.tenant_id<>p_tenant or s.job_id<>p_job or s.attempt<>p_attempt or s.worker<>p_worker or s.definition<>p_definition then raise exception 'processing_settlement_conflict' using errcode='PT409';end if;
  return s.receipt;
 end if;
 if p_phase='inspect' then raise exception 'processing_receipt_missing' using errcode='PT409';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found or j.status<>'running' or j.claimed_by is distinct from p_worker or j.attempt_count<>p_attempt or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp()
  or j.job_type not in('identity.resolve','interactions.sync') then raise exception 'processing_claim_lost' using errcode='PT409';end if;
 allowed_keys:=case j.job_type when 'identity.resolve' then array['resolved','cards_enriched','people_created','companies_created','recommendations','suggestions_created','events_consumed','review_required','failed','continued']
  else array['phone_selected','phone_created','phone_updated','phone_skipped','email_selected','email_created','email_updated','interactions_upserted','phone_processed','email_processed','skipped','review_required','failed','continued'] end;
 for entry in select * from jsonb_each(p_definition->'result') loop
  if not entry.key=any(allowed_keys) or (entry.key='continued' and jsonb_typeof(entry.value)<>'boolean')
   or (entry.key<>'continued' and (jsonb_typeof(entry.value)<>'number' or entry.value::text!~'^[0-9]{1,6}$')) then raise exception 'processing_result_invalid' using errcode='22023';end if;
 end loop;
 if success and (coalesce((p_definition->'result'->>'failed')::integer,0)>0 or coalesce((p_definition->'result'->>'review_required')::integer,0)>0)
 then raise exception 'processing_success_unconfirmed' using errcode='PT409';end if;
 select count(*) into actual from public.learn_processing_publications where tenant_id=p_tenant and job_id=p_job and attempt=p_attempt and worker=p_worker and receipt->>'state'='committed'
  and case when j.job_type='identity.resolve' then receipt->'cardEnriched'='true'::jsonb else receipt->>'action'<>'unchanged' end;
 if records>actual or (success and records<>actual) then raise exception 'processing_count_unconfirmed' using errcode='PT409';end if;
 at_time:=clock_timestamp();retry:=not success and (p_definition->>'retryable')::boolean and p_attempt<j.max_attempts;
 outcome:=case when success then 'succeeded' when retry then 'retrying' else 'dead_letter' end;
 delay:=case p_attempt when 1 then 60 when 2 then 300 when 3 then 900 else 3600 end;
 update public.platform_jobs set status=outcome,result=p_definition->'result',records_processed=records,lease_expires_at=null,
  completed_at=case when success then at_time else null end,failed_at=case when outcome='dead_letter' then at_time else null end,
  dead_lettered_at=case when outcome='dead_letter' then at_time else null end,error_code=p_definition->>'error_code',
  last_error=case when success then null else 'Retained-input processing requires retry or operator review. See the recorded error code and source receipts.' end,
  error_count=case when success then 0 else p_attempt end,
  available_at=case when retry then at_time+make_interval(secs=>delay) else available_at end,
  next_run_at=case when retry then at_time+make_interval(secs=>delay) else next_run_at end
 where tenant_id=p_tenant and id=p_job;
 if continued then
  limit_n:=case when coalesce(j.payload->>'limit','')~'^[0-9]{1,6}$' then greatest(1,least(50,(j.payload->>'limit')::integer)) else 20 end;
  source:=coalesce(j.payload->>'source','all');
  if j.job_type='interactions.sync' and source not in('all','phone','email') then raise exception 'processing_source_mismatch' using errcode='PT409';end if;
  key:=case j.job_type when 'identity.resolve' then 'identity.resolve:'||p_tenant::text else 'interactions.sync:'||p_tenant::text||':'||source end;
  payload:=jsonb_build_object('limit',limit_n)||case j.job_type when 'interactions.sync' then jsonb_build_object('source',source) else '{}'::jsonb end;
  insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,available_at,parent_job_id,payload)
   values(p_tenant,'openfolk-core',case j.job_type when 'identity.resolve' then 'core.identity' else 'core.interactions' end,j.job_type,key,'queued',50,j.max_attempts,at_time,p_job,payload)
   on conflict(tenant_id,job_key) where job_key is not null and status in('queued','running','retrying') do nothing returning * into child;
  if child.id is null then select * into child from public.platform_jobs where tenant_id=p_tenant and job_key=key and status in('queued','running','retrying') for share;end if;
  if child.id is null or child.job_type<>j.job_type or (j.job_type='interactions.sync' and coalesce(child.payload->>'source','all')<>source)
  then raise exception 'processing_continuation_unconfirmed' using errcode='PT409';end if;
 end if;
 r:=jsonb_build_object('version','learn-processing-settlement/1','tenant_id',p_tenant,'job_id',p_job,'attempt',p_attempt,'worker',p_worker,'request_id',p_request,
  'job_type',j.job_type,'state',outcome,'continuation_job_id',child.id,'records_processed',records,'publications_committed',actual,'settled_at',at_time);
 insert into public.learn_processing_settlements(request_id,tenant_id,job_id,attempt,worker,definition,receipt) values(p_request,p_tenant,p_job,p_attempt,p_worker,p_definition,r);
 return r;
end$$;
revoke all on function public.learn_processing_settle(uuid,uuid,text,integer,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_processing_settle(uuid,uuid,text,integer,uuid,jsonb,text) to service_role;

-- INPUT supabase/migrations/20261101380000_learn_email_draft_eligibility.sql
-- Retain unsent Gmail source records without publishing them as customer replies.
-- Existing source messages/interactions/cards and historical receipts are preserved.
-- Draft detection is based on retained provider labels, never a caller-supplied flag.

create function public.learn_email_is_draft(m public.email_messages) returns boolean
 language sql stable strict set search_path=pg_catalog as $$
 select coalesce(m.provider='gmail' and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
$$;
create function public.learn_interaction_is_draft(p_tenant uuid,p_table text,p_source uuid) returns boolean
 language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(p_table='email_messages' and exists(select 1 from public.email_messages m
  where m.tenant_id=p_tenant and m.id=p_source and public.learn_email_is_draft(m)),false)
$$;
revoke all on function public.learn_email_is_draft(public.email_messages),public.learn_interaction_is_draft(uuid,text,uuid) from public,anon,authenticated,service_role;
create or replace function public.learn_email_source_fields(m public.email_messages) returns jsonb language sql stable strict set search_path=pg_catalog set timezone='UTC' as $$
 select jsonb_build_object('source_connector_id','email','source_type','email','source_table','email_messages','source_id',m.id,
 'source_external_id',m.provider_message_id,'interaction_type',case when public.learn_email_is_draft(m) then 'email_draft' else 'email_message' end,'direction',case when public.learn_email_is_draft(m) then 'unknown' when m.direction in('inbound','outbound','internal') then m.direction else 'unknown' end,
 'occurred_at',coalesce(m.received_at,m.sent_at,m.created_at),'subject',m.subject,'summary',null,'body_preview',m.snippet,
 'from_address',m.from_email,'from_name',m.from_name,'to_addresses',m.to_emails,'cc_addresses',m.cc_emails,'related_thread_id',m.provider_thread_id)
$$;
create or replace function public.learn_projection_pending(p_tenant uuid,p_source text,p_limit integer default 100)
 returns table(source_kind text,source_id uuid,source_revision text)
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
begin
 if p_source is null or p_source not in('all','phone','email') then raise exception 'projection_source_invalid' using errcode='22023';end if;
 return query with candidates as (
  select 'phone'::text as kind,c.id,coalesce(c.started_at,c.created_at) as occurred,
   public.learn_projection_revision(public.learn_phone_source_fields(c),case when i.metadata?'phone_handoff' then public.phone_projection_version(p_tenant,c.id) else null end) as revision,
   i.id is null or case when i.metadata?'phone_handoff' then i.source_version is distinct from public.phone_projection_version(p_tenant,c.id)
    else i.metadata->'source_projection'->>'revision' is distinct from public.learn_projection_revision(public.learn_phone_source_fields(c),null) end as dirty
  from public.phone_calls c left join public.interactions i on i.tenant_id=c.tenant_id and i.source_table='phone_calls' and i.source_id=c.id
  where c.tenant_id=p_tenant and p_source in('all','phone')
  union all
  select 'email',m.id,coalesce(m.received_at,m.sent_at,m.created_at),public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id','')),
   i.id is null or i.metadata->'source_projection'->>'revision' is distinct from public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id',''))
  from public.email_messages m left join public.interactions i on i.tenant_id=m.tenant_id and i.source_table='email_messages' and i.source_id=m.id
  where m.tenant_id=p_tenant and p_source in('all','email') and not public.learn_email_is_draft(m)
 ) select x.kind,x.id,x.revision from candidates x where x.dirty
 and exists(select 1 from public.tenants t where t.id=p_tenant and t.status='active')
 and not exists(select 1 from public.learn_interaction_projection_receipts r where r.tenant_id=p_tenant and r.source_kind=x.kind and r.source_id=x.id and r.source_revision=x.revision and r.receipt->>'state'='review_required')
 order by x.occurred,x.kind,x.id limit greatest(1,least(2000,coalesce(p_limit,100)));
end$$;
create or replace function public.learn_project_interaction(p_tenant uuid,p_request uuid,p_source text,p_source_id uuid,p_revision text,p_phase text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
#variable_conflict use_column
declare c public.phone_calls%rowtype;m public.email_messages%rowtype;i public.interactions%rowtype;
 saved public.learn_interaction_projection_receipts%rowtype;fields jsonb;actual text;table_name text;
 reason text;answer jsonb;event_id uuid;interaction_id uuid;created boolean:=false;prior_fields jsonb;
 provider text;version text;h jsonb;run_id uuid;campaign uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'projection_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_request is null or p_source is null or p_source not in('phone','email') or p_source_id is null
 or coalesce(p_revision,'') !~ '^[a-f0-9]{64}$' or p_phase is null or p_phase not in('publish','inspect') then raise exception 'projection_request_invalid' using errcode='22023';end if;
 select * into saved from public.learn_interaction_projection_receipts where request_id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.source_kind<>p_source or saved.source_id<>p_source_id or saved.source_revision<>p_revision then raise exception 'projection_receipt_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 if p_phase='inspect' then raise exception 'projection_receipt_missing' using errcode='PT409';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 perform pg_advisory_xact_lock(hashtextextended('learn-project:'||p_tenant::text||':'||p_source||':'||p_source_id::text,0));
 select * into saved from public.learn_interaction_projection_receipts where request_id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.source_kind<>p_source or saved.source_id<>p_source_id or saved.source_revision<>p_revision then raise exception 'projection_receipt_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 if not public.learn_capture_allowed(p_tenant,p_source) then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 table_name:=case p_source when 'phone' then 'phone_calls' else 'email_messages' end;
 -- Observe authoritative ownership before taking the legacy source lock. The
 -- phone publisher owns recording->run->transcript->insight->call->interaction.
 select * into i from public.interactions where tenant_id=p_tenant and source_table=table_name and source_id=p_source_id;
 if p_source='phone' and i.metadata?'phone_handoff' then
  select * into c from public.phone_calls where tenant_id=p_tenant and id=p_source_id;
  if not found then raise exception 'projection_source_changed' using errcode='PT409';end if;
  actual:=public.learn_projection_revision(public.learn_phone_source_fields(c),public.phone_projection_version(p_tenant,c.id));
  if actual<>p_revision then raise exception 'projection_source_changed' using errcode='PT409';end if;
  if i.source_version=public.phone_projection_version(p_tenant,c.id) then
   answer:=jsonb_build_object('version','learn-interaction-projection/1','state','committed','tenantId',p_tenant,'requestId',p_request,'sourceKind',p_source,'sourceId',p_source_id,'sourceRevision',p_revision,'interactionId',i.id,'eventId',null,'action','unchanged');
  else
  -- Only the existing exact-provenance publisher may refresh this interaction.
  run_id:=p_request;
  insert into public.phone_sync_runs(id,tenant_id,provider,sync_type,status,metadata)
   values(run_id,p_tenant,'pipeline','pipeline','running',jsonb_build_object('recording_id',i.metadata->'phone_handoff'->>'recordingId','repair_only',true,'source','interactions.sync'));
  h:=public.learn_phone_handoff(p_tenant,run_id,(i.metadata->'phone_handoff'->>'recordingId')::uuid,
   (i.metadata->'phone_handoff'->>'transcriptId')::uuid,(i.metadata->'phone_handoff'->>'insightId')::uuid,'publish');
  select * into c from public.phone_calls where tenant_id=p_tenant and id=p_source_id;
  if public.learn_projection_revision(public.learn_phone_source_fields(c),public.phone_projection_version(p_tenant,c.id))<>p_revision
   or h->>'callId'<>c.id::text or h->>'interactionId'<>i.id::text then raise exception 'projection_source_changed' using errcode='PT409';end if;
  update public.phone_sync_runs set status='success',completed_at=clock_timestamp(),records_processed=1,metadata=metadata||jsonb_build_object('handoff_receipt',h,'repair_only',true) where id=run_id and tenant_id=p_tenant;
  answer:=jsonb_build_object('version','learn-interaction-projection/1','state','committed','tenantId',p_tenant,'requestId',p_request,'sourceKind',p_source,'sourceId',p_source_id,'sourceRevision',p_revision,'interactionId',i.id,'eventId',h->'eventId','action',case when (h->>'alreadyEnriched')::boolean then 'unchanged' else 'authoritative_phone_refresh' end);
  end if;
 else
  if p_source='phone' then
   select * into c from public.phone_calls where tenant_id=p_tenant and id=p_source_id for update;
   if not found then raise exception 'projection_source_changed' using errcode='PT409';end if;
   fields:=public.learn_phone_source_fields(c);provider:=c.provider;version:=null;
  else
   select * into m from public.email_messages where tenant_id=p_tenant and id=p_source_id for update;
   if not found then raise exception 'projection_source_changed' using errcode='PT409';end if;
   if public.learn_email_is_draft(m) then reason:='email_draft';end if;
   fields:=public.learn_email_source_fields(m);provider:=m.provider;version:=coalesce(to_jsonb(m)->>'origin_campaign_id','');
   if version<>'' then campaign:=version::uuid;end if;
   if jsonb_typeof(m.to_emails) is distinct from 'array' or jsonb_typeof(m.cc_emails) is distinct from 'array'
    or exists(select 1 from jsonb_array_elements(m.to_emails||m.cc_emails) e where jsonb_typeof(e)<>'string') then reason:=coalesce(reason,'email_addresses_unverified');end if;
  end if;
  actual:=public.learn_projection_revision(fields,version);
  if actual<>p_revision then raise exception 'projection_source_changed' using errcode='PT409';end if;
  select * into i from public.interactions where tenant_id=p_tenant and source_table=table_name and source_id=p_source_id for update;
  created:=not found;
  -- A concurrent live publisher may have won since the initial ownership read.
  if not created and i.metadata?'phone_handoff' then raise exception 'projection_owner_changed' using errcode='PT409';end if;
  if not created and not(i.metadata?'source_projection') then reason:=coalesce(reason,'legacy_projection_review');end if;
  if not created and i.metadata?'source_projection' then
   select jsonb_object_agg(k,to_jsonb(i)->k) into prior_fields from jsonb_object_keys(i.metadata->'source_projection'->'fields') k;
   if prior_fields is distinct from i.metadata->'source_projection'->'fields' then reason:=coalesce(reason,'canonical_fields_changed');end if;
  end if;
  if reason is not null then
   answer:=jsonb_build_object('version','learn-interaction-projection/1','state','review_required','tenantId',p_tenant,'requestId',p_request,'sourceKind',p_source,'sourceId',p_source_id,'sourceRevision',p_revision,'interactionId',i.id,'eventId',null,'action','held','reason',reason);
  elsif not created and i.metadata->'source_projection'->>'revision'=p_revision then
   answer:=jsonb_build_object('version','learn-interaction-projection/1','state','committed','tenantId',p_tenant,'requestId',p_request,'sourceKind',p_source,'sourceId',p_source_id,'sourceRevision',p_revision,'interactionId',i.id,'eventId',null,'action','unchanged');
  else
   insert into public.interactions as target(tenant_id,source_connector_id,source_type,source_table,source_id,source_external_id,interaction_type,direction,occurred_at,subject,summary,body_preview,
    from_address,from_name,to_addresses,cc_addresses,phone_from,phone_to,related_thread_id,processing_status,metadata)
   values(p_tenant,fields->>'source_connector_id',p_source,table_name,p_source_id,fields->>'source_external_id',fields->>'interaction_type',fields->>'direction',(fields->>'occurred_at')::timestamptz,
    fields->>'subject',fields->>'summary',fields->>'body_preview',fields->>'from_address',fields->>'from_name',array(select jsonb_array_elements_text(coalesce(fields->'to_addresses','[]'))),array(select jsonb_array_elements_text(coalesce(fields->'cc_addresses','[]'))),
    fields->>'phone_from',fields->>'phone_to',fields->>'related_thread_id','ready',jsonb_build_object('source_projection',jsonb_build_object('version','learn-interaction-projection/1','revision',p_revision,'fields',fields,'provider',provider,'coverage','unverified','accountBinding','unverified')))
   on conflict(tenant_id,source_table,source_id) do update set source_connector_id=excluded.source_connector_id,source_external_id=excluded.source_external_id,direction=excluded.direction,occurred_at=excluded.occurred_at,
    subject=excluded.subject,summary=excluded.summary,body_preview=excluded.body_preview,from_address=excluded.from_address,from_name=excluded.from_name,to_addresses=excluded.to_addresses,cc_addresses=excluded.cc_addresses,
    phone_from=excluded.phone_from,phone_to=excluded.phone_to,related_thread_id=excluded.related_thread_id,processing_status='ready',metadata=target.metadata||excluded.metadata
    where target.id=i.id and target.metadata->'source_projection'=i.metadata->'source_projection'
   returning id into interaction_id;
   if interaction_id is null then raise exception 'projection_owner_changed' using errcode='PT409';end if;
   if campaign is not null then
    -- The historical TEST schema lacks this optional Marketing column. Preserve
    -- campaign provenance in metadata there; set its native link where supported.
    update public.interactions set metadata=metadata||jsonb_build_object('origin_campaign_id',campaign) where tenant_id=p_tenant and id=interaction_id;
    if exists(select 1 from pg_attribute where attrelid='public.interactions'::regclass and attname='related_campaign_id' and not attisdropped) then
     if to_jsonb(i)->>'related_campaign_id' is not null and to_jsonb(i)->>'related_campaign_id'<>campaign::text then raise exception 'projection_campaign_conflict' using errcode='PT409';end if;
     execute 'update public.interactions set related_campaign_id=$1 where tenant_id=$2 and id=$3' using campaign,p_tenant,interaction_id;
    end if;
   end if;
   insert into public.platform_events as e(tenant_id,event_type,subject_type,subject_id,source,status,payload)
    values(p_tenant,'interaction.ready','interaction',interaction_id,'interactions-sync','pending',jsonb_build_object('projection_revision',p_revision,'source_kind',p_source,'source_id',p_source_id))
    on conflict(tenant_id,event_type,subject_id) where status='pending' do update set payload=e.payload||excluded.payload returning id into event_id;
   answer:=jsonb_build_object('version','learn-interaction-projection/1','state','committed','tenantId',p_tenant,'requestId',p_request,'sourceKind',p_source,'sourceId',p_source_id,'sourceRevision',p_revision,'interactionId',interaction_id,'eventId',event_id,'action',case when created then 'created' else 'updated' end);
  end if;
 end if;
 insert into public.learn_interaction_projection_receipts(request_id,tenant_id,source_kind,source_id,source_revision,receipt) values(p_request,p_tenant,p_source,p_source_id,p_revision,answer);
 return answer;
end$$;
create or replace function public.learn_identity_deliver_internal(p_tenant uuid,p_request uuid,p_interaction uuid,p_revision text,p_phase text,p_reviewed_person uuid)
 returns jsonb language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
#variable_conflict use_column
<<delivery>>
declare
 i public.interactions%rowtype;p public.people%rowtype;c public.companies%rowtype;card public.customer_cards%rowtype;
 saved public.learn_identity_delivery_receipts%rowtype;event public.platform_events%rowtype;
 email text;phone text;contact_name text;domain text;person_id uuid;company_id uuid;email_id uuid;phone_id uuid;
 matches integer;created_person boolean:=false;created_company boolean:=false;new_card boolean:=false;
 reason text;confidence numeric:=0;evidence jsonb:='[]';company_evidence jsonb:='[]';person_level text:='possible';
 answer jsonb;suggestions integer:=0;recs integer:=0;consumed integer:=0;affected integer:=0;
 interaction_count integer;today_count integer;open_rec_score integer;priority_score integer;priority_bucket text;
 start_today timestamptz:=date_trunc('day',statement_timestamp());activity timestamptz;has_phone_receipt boolean;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'identity_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_request is null or p_interaction is null or coalesce(p_revision,'') !~ '^[a-f0-9]{64}$'
 or p_phase is null or p_phase not in('publish','inspect') then raise exception 'identity_request_invalid' using errcode='22023';end if;
 select * into saved from public.learn_identity_delivery_receipts where request_id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.interaction_id<>p_interaction or saved.source_revision<>p_revision then raise exception 'identity_receipt_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 if p_phase='inspect' then raise exception 'identity_receipt_missing' using errcode='PT409';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 -- Serialise this engine's provisional identity creation within the tenant.
 perform pg_advisory_xact_lock(hashtextextended('learn-identity:'||p_tenant::text,0));
 select * into saved from public.learn_identity_delivery_receipts where request_id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.interaction_id<>p_interaction or saved.source_revision<>p_revision then raise exception 'identity_receipt_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'identity_tenant_inactive' using errcode='PT409';end if;
 select * into i from public.interactions where tenant_id=p_tenant and id=p_interaction for update;
 if not found or public.learn_identity_revision(i)<>p_revision or i.processing_status not in('pending','ready','identity_review')
 then raise exception 'identity_source_changed' using errcode='PT409';end if;
 select * into event from public.platform_events where tenant_id=p_tenant and event_type='interaction.ready' and subject_type='interaction'
 and subject_id=i.id and status='pending' for update;
 has_phone_receipt:=i.metadata->'phone_handoff'->>'version'='learn-phone-handoff/1';
 if coalesce(has_phone_receipt,false) and (event.id is null or event.payload->>'source_fingerprint' is distinct from i.metadata->'phone_handoff'->>'sourceFingerprint')
 then raise exception 'identity_event_changed' using errcode='PT409';end if;
 if public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id) then reason:='email_draft';
 elsif i.direction='internal' then reason:='internal_interaction';
 elsif i.direction not in('inbound','outbound') or i.direction is null then reason:='direction_unverified';end if;
 email:=nullif(lower(btrim(case when i.direction='outbound' then i.to_addresses[1] else i.from_address end)),'');
 phone:=nullif(btrim(case when i.direction='outbound' then i.phone_to else i.phone_from end),'');
 contact_name:=case when i.direction='inbound' then nullif(btrim(i.from_name),'') else null end;
 -- Treat provider text as data. No dynamic filters or SQL are built from identifiers.
 if email is not null and email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then reason:=coalesce(reason,'email_unverified');end if;
 if phone is not null and phone !~ '^\+?[0-9][0-9 ()-]{4,30}$' then reason:=coalesce(reason,'phone_unverified');end if;
 if email is null and phone is null then reason:=coalesce(reason,'contact_missing');end if;
 if reason is null and p_reviewed_person is not null then
  select * into p from public.people where tenant_id=p_tenant and id=p_reviewed_person for update;
  if not found then raise exception 'identity_review_person_unavailable' using errcode='PT409';end if;
  person_id:=p.id;company_id:=p.company_id;
  contact_name:=coalesce(p.display_name,p.primary_email,p.primary_phone);
  if company_id is not null then
   select * into c from public.companies where tenant_id=p_tenant and id=company_id for share;
   if not found then raise exception 'identity_review_company_unavailable' using errcode='PT409';end if;
  end if;
  confidence:=1;person_level:='confirmed';
  evidence:=jsonb_build_array(jsonb_build_object('source','operator_attribution','detail','An authorised operator attributed this communication to the selected contact; this does not verify the contact globally','requestId',p_request,'weight',1));
 else
 if reason is null and email is not null then
  select count(*),min(x.id::text)::uuid into matches,email_id from public.people x where x.tenant_id=p_tenant and lower(btrim(x.primary_email))=email;
  if matches>1 then reason:='person_ambiguous';end if;
 end if;
 if reason is null and phone is not null then
  select count(*),min(x.id::text)::uuid into matches,phone_id from public.people x where x.tenant_id=p_tenant and btrim(x.primary_phone)=phone;
  if matches>1 then reason:='person_ambiguous';end if;
 end if;
 if reason is null and email_id is not null and phone_id is not null and email_id<>phone_id then reason:='person_conflict';end if;
 if reason is null then
  person_id:=coalesce(email_id,phone_id);
  if i.related_person_id is not null then
   perform 1 from public.people where tenant_id=p_tenant and id=i.related_person_id;
   if not found then reason:='person_link_invalid';
   elsif person_id is not null and person_id<>i.related_person_id then reason:='person_link_conflict';
   else person_id:=i.related_person_id;end if;
  end if;
 end if;
 if reason is null and person_id is not null then
  select * into p from public.people where tenant_id=p_tenant and id=person_id for update;
  if not found then raise exception 'identity_source_changed' using errcode='PT409';end if;
  confidence:=case when email_id=person_id then 0.95 when phone_id=person_id then 0.92 else 0 end;
  person_level:=case when confidence>=0.9 then 'confirmed' else 'possible' end;
  evidence:=jsonb_build_array(jsonb_build_object('source',case when email_id=person_id then 'email' when phone_id=person_id then 'phone' else 'existing_interaction_link' end,
   'detail',case when confidence>=0.9 then 'Unique exact contact match within this tenant' else 'Preserved existing interaction attribution; contact match unverified' end,'weight',confidence));
  company_id:=coalesce(i.related_company_id,p.company_id);
  if i.related_company_id is not null and p.company_id is not null and i.related_company_id<>p.company_id then reason:='company_link_conflict';end if;
 else company_id:=i.related_company_id;end if;
 if reason is null and company_id is not null then
  select * into c from public.companies where tenant_id=p_tenant and id=company_id for share;
  if not found then reason:='company_link_invalid';end if;
 end if;
 if reason is null and company_id is null and email is not null then
  domain:=split_part(email,'@',2);
  if domain<>all(array['gmail.com','googlemail.com','outlook.com','hotmail.com','hotmail.co.uk','live.com','yahoo.com','yahoo.co.uk','icloud.com','me.com','aol.com','btinternet.com','sky.com','msn.com','protonmail.com','gmx.com']) then
   select count(*),min(x.id::text)::uuid into matches,company_id from public.companies x where x.tenant_id=p_tenant and lower(btrim(x.domain))=domain;
   if matches>1 then reason:='company_ambiguous';
   elsif company_id is not null then
    select * into c from public.companies where tenant_id=p_tenant and id=company_id for share;
    company_evidence:=jsonb_build_array(jsonb_build_object('source','email_domain','detail','Unique company domain match; provisional attribution','weight',0.85));
   end if;
  else domain:=null;end if;
 end if;
 if reason is null and exists(select 1 from public.interaction_match_suggestions s where s.tenant_id=p_tenant and s.interaction_id=i.id and s.status='rejected' and ((s.target_type='person' and s.target_id=person_id) or (s.target_type='company' and s.target_id=company_id))) then reason:='reviewed_match_rejected';end if;
 end if;
 -- Never consume a signal or invent a card when its external identity needs review.
 if reason is not null then
  update public.interactions set processing_status='identity_review',metadata=metadata||jsonb_build_object('identity_delivery',jsonb_build_object('state','review_required','reason',reason,'requestId',p_request)) where id=i.id and tenant_id=p_tenant;
  get diagnostics affected=row_count;if affected<>1 then raise exception 'identity_source_changed' using errcode='PT409';end if;
  answer:=jsonb_build_object('version','learn-identity-delivery/1','state','review_required','tenantId',p_tenant,'requestId',p_request,'interactionId',i.id,'sourceRevision',p_revision,'reason',reason,'cardId',null,'personCreated',false,'companyCreated',false,'cardEnriched',false,'recommendations',0,'suggestions',0,'eventsConsumed',0);
 else
  if company_id is null and domain is not null then
   insert into public.companies(tenant_id,name,domain,verified,created_source) values(p_tenant,domain,domain,false,'interaction') returning id into company_id;
   created_company:=true;
  end if;
  if person_id is null then
   insert into public.people(tenant_id,primary_email,primary_phone,display_name,company_id,verified,created_source,metadata)
    values(p_tenant,email,phone,contact_name,company_id,false,'interaction',jsonb_build_object('origin_interaction',i.id)) returning * into p;
   person_id:=p.id;created_person:=true;confidence:=0;
   evidence:=jsonb_build_array(jsonb_build_object('source','interaction','detail','Provisional contact created from source identifier; identity review required','weight',0));
  end if;
  -- Preserve reviewed suggestions instead of resetting accepted/rejected decisions.
  if not created_person then
   insert into public.interaction_match_suggestions as s(tenant_id,interaction_id,target_type,target_id,match_level,confidence,evidence,explanation,recommended_action,status,created_by)
    values(p_tenant,i.id,'person',person_id,person_level,confidence,evidence,'Contact evidence retained with the interaction','Review contact attribution','pending','system')
    on conflict(tenant_id,interaction_id,target_type,target_id) do update set confidence=excluded.confidence,evidence=excluded.evidence,explanation=excluded.explanation where s.status='pending';
   get diagnostics suggestions=row_count;
  end if;
  if company_id is not null and company_evidence<>'[]'::jsonb then
   insert into public.interaction_match_suggestions as s(tenant_id,interaction_id,target_type,target_id,match_level,confidence,evidence,explanation,status,created_by)
    values(p_tenant,i.id,'company',company_id,'likely',0.85,company_evidence,'Provisional attribution from company domain','pending','system')
    on conflict(tenant_id,interaction_id,target_type,target_id) do update set evidence=excluded.evidence where s.status='pending';
   get diagnostics affected=row_count;suggestions:=suggestions+affected;
  end if;
  -- Link inside this transaction so aggregate counts include this interaction.
  update public.interactions set related_person_id=person_id,related_company_id=company_id where tenant_id=p_tenant and id=i.id;
  get diagnostics affected=row_count;if affected<>1 then raise exception 'identity_source_changed' using errcode='PT409';end if;
  select count(*),count(*) filter(where occurred_at>=start_today and occurred_at<start_today+interval '1 day') into interaction_count,today_count
   from public.interactions x where tenant_id=p_tenant and related_person_id=person_id and not public.learn_interaction_is_draft(x.tenant_id,x.source_table,x.source_id);
  select * into card from public.customer_cards x where x.tenant_id=p_tenant and x.person_id=delivery.person_id for update;
  if not found then
   insert into public.customer_cards(tenant_id,person_id,company_id,title,summary,latest_activity_at,confidence)
    values(p_tenant,person_id,company_id,coalesce(contact_name,p.display_name,email,phone),coalesce(i.summary,i.body_preview),i.occurred_at,confidence)
    on conflict(tenant_id,person_id) where person_id is not null do nothing returning * into card;
   new_card:=found;
   if not new_card then select * into card from public.customer_cards x where x.tenant_id=p_tenant and x.person_id=delivery.person_id for update;end if;
  end if;
  if card.id is null then raise exception 'identity_card_unconfirmed' using errcode='PT409';end if;
  if today_count>=2 then
   insert into public.recommendations(tenant_id,type,title,detail,severity,status,card_id,interaction_id,person_id,company_id,evidence,recommended_action,created_by)
    values(p_tenant,'repeat_contact_today','Repeated contact today','Multiple interactions recorded during the current UTC day; review response needs.','high','open',card.id,i.id,person_id,company_id,
     jsonb_build_array(jsonb_build_object('source','interactions','count',today_count,'periodStart',start_today,'timezone','UTC')),'Review and respond','system')
    on conflict(tenant_id,card_id,type) where status='open' and card_id is not null do nothing;
   get diagnostics affected=row_count;recs:=recs+affected;
  end if;
  if created_person then
   insert into public.recommendations(tenant_id,type,title,detail,severity,status,card_id,interaction_id,person_id,company_id,evidence,recommended_action,created_by)
    values(p_tenant,'review_new_contact','New contact — confirm identity','Provisional contact from a source interaction; confirm or link it.','info','open',card.id,i.id,person_id,company_id,evidence,'Review and confirm the contact','system')
    on conflict(tenant_id,card_id,type) where status='open' and card_id is not null do nothing;
   get diagnostics affected=row_count;recs:=recs+affected;
  end if;
  select coalesce(sum(case severity when 'critical' then 30 when 'high' then 20 when 'medium' then 10 when 'low' then 5 else 2 end),0) into open_rec_score
   from public.recommendations where tenant_id=p_tenant and card_id=card.id and status='open';
  priority_score:=least(100,20+least(30,interaction_count*5)+open_rec_score+case when i.sentiment='negative' then 20 else 0 end+case when today_count>=2 then 15 else 0 end);
  priority_bucket:=case when priority_score>=75 then 'critical' when priority_score>=50 then 'high' when priority_score>=25 then 'medium' else 'low' end;
  activity:=greatest(card.latest_activity_at,i.occurred_at);
  -- Read locks and manual values at commit time, not from a stale client snapshot.
  update public.customer_cards x set
   company_id=case when 'company_id'=any(card.locked_fields) then x.company_id else delivery.company_id end,
   title=case when 'title'=any(card.locked_fields) then x.title else coalesce(contact_name,p.display_name,email,phone,x.title) end,
   summary=case when 'summary'=any(card.locked_fields) or card.latest_activity_at>i.occurred_at then x.summary else coalesce(i.summary,i.body_preview,x.summary) end,
   latest_activity_at=case when 'latest_activity_at'=any(card.locked_fields) then x.latest_activity_at else activity end,
   confidence=case when 'confidence'=any(card.locked_fields) then x.confidence else delivery.confidence end,
   priority=case when card.locked_fields&&array['priority','priority_score','priority_inputs'] then x.priority else priority_bucket end,
   priority_score=case when card.locked_fields&&array['priority','priority_score','priority_inputs'] then x.priority_score else delivery.priority_score end,
   priority_inputs=case when card.locked_fields&&array['priority','priority_score','priority_inputs'] then x.priority_inputs else jsonb_build_object('version','identity-priority/2','interaction_count',interaction_count,'open_rec_score',open_rec_score,'negative_sentiment',i.sentiment='negative','repeat_today',today_count>=2,'periodStart',start_today,'timezone','UTC','sourceInteractionId',i.id,'sourceRevision',p_revision) end
   where x.tenant_id=p_tenant and x.id=card.id;
  get diagnostics affected=row_count;if affected<>1 then raise exception 'identity_card_unconfirmed' using errcode='PT409';end if;
  if event.id is not null then
   update public.platform_events set status='consumed',consumed_at=clock_timestamp(),metadata=metadata||jsonb_build_object('identity_delivery_request',p_request,'identity_source_revision',p_revision)
    where tenant_id=p_tenant and id=event.id and status='pending';
   get diagnostics consumed=row_count;if consumed<>1 then raise exception 'identity_event_changed' using errcode='PT409';end if;
  end if;
  update public.interactions set processing_status='enriched',metadata=metadata||jsonb_build_object('identity_delivery',jsonb_build_object('state','committed','requestId',p_request,'sourceRevision',p_revision,'cardId',card.id)) where tenant_id=p_tenant and id=i.id;
  get diagnostics affected=row_count;if affected<>1 then raise exception 'identity_source_changed' using errcode='PT409';end if;
  answer:=jsonb_build_object('version','learn-identity-delivery/1','state','committed','tenantId',p_tenant,'requestId',p_request,'interactionId',i.id,'sourceRevision',p_revision,'cardId',card.id,'personCreated',created_person,'companyCreated',created_company,'cardEnriched',true,'recommendations',recs,'suggestions',suggestions,'eventsConsumed',consumed);
 end if;
 insert into public.learn_identity_delivery_receipts(request_id,tenant_id,interaction_id,source_revision,receipt) values(p_request,p_tenant,i.id,p_revision,answer);
 return answer;
end$$;
create or replace function public.learn_identity_review_state(p_tenant uuid,p_interaction uuid,p_person uuid) returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare i public.interactions%rowtype;p public.people%rowtype;c public.companies%rowtype;reason text;revision text;rejected jsonb;source jsonb;
begin
 select * into i from public.interactions where tenant_id=p_tenant and id=p_interaction;
 if not found then raise exception 'identity_review_unavailable' using errcode='42501';end if;
 select * into p from public.people where tenant_id=p_tenant and id=p_person;
 if not found then raise exception 'identity_review_person_unavailable' using errcode='42501';end if;
 if p.company_id is not null then select * into c from public.companies where tenant_id=p_tenant and id=p.company_id;end if;
 select coalesce(jsonb_agg(jsonb_build_object('target_type',s.target_type,'target_id',s.target_id,'status',s.status,'explanation',left(s.explanation,1000)) order by s.target_type,s.target_id),'[]') into rejected
 from public.interaction_match_suggestions s where s.tenant_id=p_tenant and s.interaction_id=i.id and s.status='rejected' and ((s.target_type='person' and s.target_id=p.id) or(s.target_type='company' and s.target_id=c.id));
 reason:=case when public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id) then 'email_draft'
  when i.processing_status<>'identity_review' or i.metadata->'identity_delivery'->>'state' is distinct from 'review_required' then 'hold_changed'
  when i.direction not in('inbound','outbound') or i.direction is null then 'direction_needs_source_review'
  when p.company_id is not null and c.id is null then 'company_link_invalid'
  when exists(select 1 from public.learn_identity_delivery_receipts r where r.tenant_id=p_tenant and r.interaction_id=i.id and r.receipt->>'state'='committed') then 'previous_delivery_needs_reconciliation'
  when i.related_person_id is not null and i.related_person_id<>p.id and exists(select 1 from public.customer_cards k where k.tenant_id=p_tenant and k.person_id=i.related_person_id) then 'previous_card_needs_reconciliation'
  when coalesce(i.metadata->'identity_delivery'->>'reason','') not in('person_ambiguous','person_conflict','person_link_invalid','person_link_conflict','company_link_conflict','company_link_invalid','company_ambiguous','reviewed_match_rejected') then 'source_needs_review'
  else null end;
 source:=jsonb_build_object('source_type',i.source_type,'direction',i.direction,'occurred_at',i.occurred_at,'subject',left(i.subject,1000),'preview',left(coalesce(i.summary,i.body_preview),2000),'from_address',left(i.from_address,500),'to_address',left(i.to_addresses[1],500),'phone_from',left(i.phone_from,100),'phone_to',left(i.phone_to,100),'related_person_id',i.related_person_id,'related_company_id',i.related_company_id);
 revision:=encode(sha256(convert_to(jsonb_build_object('interaction',to_jsonb(i),'person',to_jsonb(p),'company',to_jsonb(c),'rejected',rejected)::text,'UTF8')),'hex');
 return jsonb_build_object('version','learn-identity-review-detail/1','tenant_id',p_tenant,'interaction_id',i.id,'person_id',p.id,'revision',revision,'can_apply',reason is null,'blocked_reason',reason,'hold_reason',i.metadata->'identity_delivery'->>'reason','source',source,
  'person',jsonb_build_object('name',left(p.display_name,500),'email',left(p.primary_email,500),'phone',left(p.primary_phone,100),'verified',p.verified),
  'company',case when c.id is null then null else jsonb_build_object('id',c.id,'name',left(c.name,500),'domain',left(c.domain,500)) end,
  'rejected_matches',rejected,'checked_at',clock_timestamp());
end$$;
create or replace function public.learn_identity_pending(p_tenant uuid,p_limit integer default 20)
 returns table(interaction_id uuid,source_revision text)
 language sql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
 select i.id,public.learn_identity_revision(i) from public.interactions i
 join public.tenants t on t.id=i.tenant_id and t.status='active'
 where i.tenant_id=p_tenant and i.processing_status in('pending','ready') and not public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id)
 order by i.occurred_at,i.id limit greatest(1,least(50,coalesce(p_limit,20)))
$$;
revoke all on function public.learn_identity_deliver_internal(uuid,uuid,uuid,text,text,uuid),public.learn_identity_review_state(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create or replace function public.learn_identity_deliver(p_tenant uuid,p_request uuid,p_interaction uuid,p_revision text,p_phase text)
 returns jsonb language sql security definer set search_path=pg_catalog set timezone='UTC' as $$
 select public.learn_identity_deliver_internal(p_tenant,p_request,p_interaction,p_revision,p_phase,null)
$$;
create or replace function public.learn_card_communications_read(p_tenant uuid,p_person uuid default null,p_company uuid default null,p_job uuid default null,p_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor_tenant uuid;actor_role text;result jsonb;
begin
 -- The reader role can see only the actual caller profile through its RLS policy.
 -- Policies bind auth.uid() at creation; runtime auth-schema lookup is unnecessary.
 select p.tenant_id,p.role into actor_tenant,actor_role from public.profiles p;
 if actor_tenant is distinct from p_tenant or coalesce(actor_role,'') not in ('owner','admin') then
  raise exception 'Company owner/admin communication access required' using errcode='42501';end if;
 if p_tenant is null or
  (p_ids is null and p_person is null and p_company is null and p_job is null) or
  (p_ids is not null and (cardinality(p_ids)<1 or cardinality(p_ids)>50 or array_position(p_ids,null) is not null or p_person is not null or p_company is not null or p_job is not null)) or
  (p_job is not null and (p_person is not null or p_company is not null)) then
  raise exception 'One bounded communication scope is required' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.occurred_at desc nulls last,s.id),'[]'::jsonb) into result from (
  select i.id,i.tenant_id,i.source_connector_id,i.source_type,i.source_table,i.source_id,i.occurred_at,
   case when length(i.subject)>4000 then left(i.subject,4000)||'… [excerpt shortened]' else i.subject end as subject,
   case when length(i.summary)>4000 then left(i.summary,4000)||'… [excerpt shortened]' else i.summary end as summary,
   case when length(i.body_preview)>4000 then left(i.body_preview,4000)||'… [excerpt shortened]' else i.body_preview end as body_preview,
   i.status,i.related_person_id,i.related_company_id,i.related_job_id
  from public.interactions i where i.tenant_id=p_tenant and not public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id) and coalesce(i.status,'') not in ('deleted','removed') and
   (i.related_person_id=p_person or i.related_company_id=p_company or i.related_job_id=p_job or i.id=any(p_ids))
  order by i.occurred_at desc nulls last,i.id limit 51
 ) s;
 return jsonb_build_object('version','learn-card-communications/1','tenant_id',p_tenant,'rows',result);
end $$;
grant execute on function public.learn_interaction_is_draft(uuid,text,uuid) to learn_card_communication_reader;
create or replace function public.learn_projection_review_count(p_tenant uuid,p_source text) returns integer
 language sql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
 with latest as (
  select distinct on(r.source_kind,r.source_id) r.* from public.learn_interaction_projection_receipts r
  where r.tenant_id=p_tenant and (p_source='all' or r.source_kind=p_source)
  order by r.source_kind,r.source_id,r.created_at desc,r.request_id desc
 ) select count(*)::integer from latest r where r.receipt->>'state'='review_required' and coalesce(r.receipt->>'reason','')<>'email_draft'
 and (case r.source_kind when 'phone' then exists(select 1 from public.phone_calls c left join public.interactions i
  on i.tenant_id=c.tenant_id and i.source_table='phone_calls' and i.source_id=c.id
  where c.tenant_id=p_tenant and c.id=r.source_id and r.source_revision=public.learn_projection_revision(public.learn_phone_source_fields(c),case when i.metadata?'phone_handoff' then public.phone_projection_version(p_tenant,c.id) else null end))
 else exists(select 1 from public.email_messages m where m.tenant_id=p_tenant and m.id=r.source_id and r.source_revision=public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id',''))) end)
$$;
create or replace function public.learn_identity_review_count(p_tenant uuid) returns integer
 language sql stable security definer set search_path=pg_catalog as $$
 select count(*)::integer from public.interactions i where i.tenant_id=p_tenant and i.processing_status='identity_review'
 and not public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id)
$$;

-- INPUT supabase/migrations/20261101390000_learn_card_projection_eligibility.sql
-- Card refresh must use the same retained-source eligibility as publication.
-- Filtering happens before bounded windows; source records are never removed.

create function public.learn_card_projection_inputs(p_tenant uuid,p_card uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare c public.customer_cards%rowtype; answer jsonb;
begin
 if p_tenant is null or p_card is null then raise exception 'card_projection_scope_required' using errcode='22023';end if;
 select * into c from public.customer_cards where tenant_id=p_tenant and id=p_card;
 if not found then raise exception 'card_projection_card_unavailable' using errcode='PT404';end if;
 with associated as materialized (
  select i.id,i.interaction_type,i.direction,i.occurred_at,i.sentiment,i.source_type,
   public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id) as draft
  from public.interactions i where i.tenant_id=p_tenant
   and (i.related_person_id=c.person_id or i.related_company_id=c.company_id)
   and coalesce(i.status,'') not in('deleted','removed')
 ), eligible as materialized (select * from associated where not draft),
 bounded as (select id,interaction_type,direction,occurred_at,sentiment,source_type from eligible order by occurred_at desc nulls last,id limit 100),
 recs as materialized (
  select r.id,r.type,r.title,r.severity,r.status,r.recommended_action,r.created_at,
   coalesce(public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id),false) as draft
  from public.recommendations r left join public.interactions i on i.tenant_id=r.tenant_id and i.id=r.interaction_id
  where r.tenant_id=p_tenant and r.card_id=p_card and r.status='open'
 ), eligible_recs as materialized (select * from recs where not draft),
 bounded_recs as (select id,type,title,severity,status,recommended_action,created_at from eligible_recs order by created_at desc,id limit 50)
 select jsonb_build_object('version','learn-card-inputs/1','tenantId',p_tenant,'cardId',p_card,'capturedAt',statement_timestamp(),
  'interactions',coalesce((select jsonb_agg(to_jsonb(b) order by occurred_at desc nulls last,id) from bounded b),'[]'),
  'recommendations',coalesce((select jsonb_agg(to_jsonb(b) order by created_at desc,id) from bounded_recs b),'[]'),
  'coverage',jsonb_build_object('eligibleInteractions',(select count(*) from eligible),
   'excludedDraftInteractions',(select count(*) from associated where draft),
   'interactionsLast7',(select count(*) from eligible where occurred_at>=statement_timestamp()-interval '7 days' and occurred_at<=statement_timestamp()),
   'interactionsPrev7',(select count(*) from eligible where occurred_at>=statement_timestamp()-interval '14 days' and occurred_at<statement_timestamp()-interval '7 days'),
   'eligibleRecommendations',(select count(*) from eligible_recs),
   'urgentRecommendations',(select count(*) from eligible_recs where lower(coalesce(severity,'')) in('high','critical','emergency','urgent')),
   'excludedDraftRecommendations',(select count(*) from recs where draft),
   'interactionLimit',100,'recommendationLimit',50)) into answer;
 return answer;
end$$;
revoke all on function public.learn_card_projection_inputs(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_card_projection_inputs(uuid,uuid) to service_role;

revoke create on schema public from learn_card_communication_reader;
revoke learn_card_communication_reader from postgres;
insert into of_learn_deploy.migrations values('learn_cards_delivery_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
