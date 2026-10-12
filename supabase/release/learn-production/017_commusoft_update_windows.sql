-- DRAFT: fixed Commusoft update windows; no activation or data modification.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then
  raise exception 'Reviewed production update-window target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_roster_support_v1'
  and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='b877e70fa1cc946ba0c9c8a66f28b6603f99dc8484fefd1411bf30beed325998') then
  raise exception 'Pinned production update-window prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_commusoft_update_windows_v1')
 or to_regprocedure('public.learn_commusoft_update_window(jsonb)') is not null then
  raise exception 'Production update-window candidate already exists; inspect before retry';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into observed from (-- Read-only release planning metadata. No source rows, credentials or SQL bodies.
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
  lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array['learn_commusoft_acquire_page','learn_commusoft_commit_page','learn_commusoft_finish_job','learn_operator_input_request','learn_operator_inputs']);
 if observed is distinct from '[{"hash":"997b879e65aed33471b61fc43550156a","name":"learn_commusoft_acquire_page","owner":"postgres","arguments":"p_tenant_id uuid, p_job_id uuid, p_claimed_by text, p_attempt_count integer, p_expected jsonb","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"6e9ae403bd34b16727e9edc280accd3d","name":"learn_commusoft_commit_page","owner":"postgres","arguments":"p_tenant_id uuid, p_job_id uuid, p_claimed_by text, p_attempt_count integer, p_permit_id uuid, p_envelope jsonb","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"e188fb5dbffb6ba481367c81106e21b1","name":"learn_commusoft_finish_job","owner":"postgres","arguments":"p_tenant_id uuid, p_job_id uuid, p_claimed_by text, p_attempt_count integer, p_outcome jsonb","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"26314a23032e0a3c86a9563d91cc0f3d","name":"learn_operator_input_request","owner":"postgres","arguments":"p_tenant uuid, p_request uuid, p_actor uuid, p_definition jsonb, p_mode text","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true},{"hash":"e3d6e665fd0c2253de7bd1e8bcab2692","name":"learn_operator_inputs","owner":"postgres","arguments":"p_tenant uuid","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true}]'::jsonb then
  raise exception 'Production update-window function baseline differs';end if;
end$$;
-- Bounded changed-record traversals. No activation, credentials, schedules or
-- refresh approvals are seeded. Existing raw pages and versions remain retained.
create function public.learn_commusoft_update_window(p_scope jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare first_at timestamptz;last_at timestamptz;k text;v text;
begin
 if p_scope is null or jsonb_typeof(p_scope)<>'object' then
  raise exception 'commusoft_update_window_invalid' using errcode='22023';end if;
 if not p_scope ?| array['updatedFrom','updatedBefore'] then return '{}'::jsonb;end if;
 foreach k in array array['updatedFrom','updatedBefore'] loop
  v:=p_scope->>k;
  if jsonb_typeof(p_scope->k) is distinct from 'string' or v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then
   raise exception 'commusoft_update_window_invalid' using errcode='22023';end if;
  begin
   if to_char(v::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>v then
    raise exception 'commusoft_update_window_invalid' using errcode='22023';end if;
  exception when datetime_field_overflow or invalid_datetime_format then
   raise exception 'commusoft_update_window_invalid' using errcode='22023';end;
 end loop;
 first_at:=(p_scope->>'updatedFrom')::timestamptz;last_at:=(p_scope->>'updatedBefore')::timestamptz;
 if first_at<to_timestamp(0) or first_at>=last_at then
  raise exception 'commusoft_update_window_invalid' using errcode='22023';end if;
 return jsonb_build_object('updatedFrom',p_scope->'updatedFrom','updatedBefore',p_scope->'updatedBefore');
end $$;
revoke all on function public.learn_commusoft_update_window(jsonb) from public,anon,authenticated,service_role;

-- Fail on source drift, and retain the existing function owners and grants.
do $patch$ declare d text;r record;begin
 for r in select * from (values
  ('public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text)',
   $old$p_definition-array['kind','reason','connection_id','revision','resource','contact_type','max_pages','page_size','expires_at']$old$,
   $new$p_definition-array['kind','reason','connection_id','revision','resource','contact_type','max_pages','page_size','expires_at','updatedFrom','updatedBefore']$new$),
  ('public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text)',
   $old$  connection_id:=(p_definition->>'connection_id')::uuid;$old$,
   $new$  perform public.learn_commusoft_update_window(p_definition);
  if p_definition ? 'updatedBefore' and (p_definition->>'updatedBefore')::timestamptz>clock_timestamp() then
   raise exception 'commusoft_update_window_future' using errcode='22023';end if;
  connection_id:=(p_definition->>'connection_id')::uuid;$new$),
  ('public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text)',
   $old$||case when resource='propertyContacts' then jsonb_build_object('contactType',contact_type) else '{}'::jsonb end;$old$,
   $new$||case when resource='propertyContacts' then jsonb_build_object('contactType',contact_type) else '{}'::jsonb end
   ||public.learn_commusoft_update_window(p_definition);$new$),
  ('public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text)',
   $old$and p.provider='commusoft' and p.collection='properties' and p.checkpoint_after->'complete'='true'::jsonb$old$,
   $new$and p.provider='commusoft' and p.collection='properties' and p.checkpoint_after->'complete'='true'::jsonb
     and exists(select 1 from public.learn_business_input_request_permits permit where permit.id=p.permit_id
      and permit.binding->'request'->>'resource'='properties'
      and not (permit.binding->'request') ?| array['updatedFrom','updatedBefore'])$new$),
  ('public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)',
   $old$  if req is distinct from p_expected->'request'$old$,
   $new$  req:=req||public.learn_commusoft_update_window(cfg);
  if req is distinct from p_expected->'request'$new$),
  ('public.learn_commusoft_commit_page(uuid,uuid,text,integer,uuid,jsonb)',
   $old$  b:=permit.binding; cfg:=b->'approval'; cp:=b->'checkpoint';$old$,
   $new$  b:=permit.binding; cfg:=b->'approval'; cp:=b->'checkpoint';
  if ((b->'request')-array['region','resource','after','limit','contactType','propertyId'])
    is distinct from public.learn_commusoft_update_window(cfg) then
   raise exception 'commusoft_update_window_changed' using errcode='PT409';end if;$new$),
  ('public.learn_commusoft_finish_job(uuid,uuid,text,integer,jsonb)',
   $old$'coverage','one_collection_traversal','ingestion_complete',false$old$,
   $new$'coverage',case when cfg ? 'updatedFrom' then 'one_update_window' else 'one_collection_traversal' end,
       'ingestion_complete',false$new$),
  ('public.learn_operator_inputs(uuid)',
   $old$'contact_target_count',a.settings->'commusoft_import'->'contactTargetCount',$old$,
   $new$'updated_window',case when a.settings->'commusoft_import' ? 'updatedFrom' then
    jsonb_build_object('updatedFrom',a.settings->'commusoft_import'->'updatedFrom',
     'updatedBefore',a.settings->'commusoft_import'->'updatedBefore') else null end,
   'contact_target_count',a.settings->'commusoft_import'->'contactTargetCount',$new$)
 ) as patches(signature,old_source,new_source) loop
  d:=pg_get_functiondef(r.signature::regprocedure);
  if (length(d)-length(replace(d,r.old_source,'')))<>length(r.old_source) then
   raise exception 'commusoft_update_window_source_changed: %',r.signature;end if;
  execute replace(d,r.old_source,r.new_source);
 end loop;
end $patch$;

insert into of_learn_deploy.migrations values('learn_commusoft_update_windows_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
