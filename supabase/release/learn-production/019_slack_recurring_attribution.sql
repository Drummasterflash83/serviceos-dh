-- DRAFT: recorded operator attribution for recurring Slack work; no activation or data modification.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then
  raise exception 'Reviewed production recurring Slack attribution target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_slack_user_operator_v1'
  and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='304b2e84f822b703a882b184ee490268f2b3802c817dee5f7953c7180a8962d2') then
  raise exception 'Pinned production recurring Slack attribution prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_slack_recurring_attribution_v1')
 or to_regprocedure('public.learn_slack_recurring_attribution_allowed(text,jsonb)') is not null then
  raise exception 'Production recurring Slack attribution candidate already exists; inspect before retry';end if;
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
  lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array['learn_slack_claim_jobs','learn_slack_reference_guard']);
 if observed is distinct from '[{"hash":"8914ff1958887224e2099043b02008d4","name":"learn_slack_claim_jobs","owner":"postgres","arguments":"p_worker uuid, p_batch integer","anonExecute":false,"serviceExecute":true,"securityDefiner":false,"authenticatedExecute":false},{"hash":"bf0ad13022efbe46cbb81ad0d64e2a79","name":"learn_slack_reference_guard","owner":"postgres","arguments":"","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false}]'::jsonb then
  raise exception 'Production recurring Slack attribution function baseline differs';end if;
end$$;
-- Carry a recorded operator approval into its bounded recurring work. No new
-- subscription, grant, credential, job or provider request is created here.
create function public.learn_slack_recurring_attribution_allowed(p_table text,p_row jsonb)
returns boolean language sql volatile security definer set search_path=pg_catalog as $$
 select auth.role()='service_role' and exists(
  select 1 from public.slack_recurring_channels s
  join public.connector_accounts a on a.id=s.account_id and a.tenant_id=s.tenant_id
  join public.tenant_connectors tc on tc.id=a.tenant_connector_id and tc.tenant_id=s.tenant_id
  join public.provider_connections c on c.id=s.connection_id and c.tenant_id=s.tenant_id
  join public.profiles p on p.id=s.approved_by
  where s.account_id=(p_row->>'account_id')::uuid and s.tenant_id=(p_row->>'tenant_id')::uuid
   and s.approved_by=(p_row->>'approved_by')::uuid and s.enabled
   and a.status='active' and a.settings->'slack_history'->'approved'='true'::jsonb
   and tc.connector_id='slack' and tc.enabled and tc.status='active'
   and public.learn_capture_allowed(s.tenant_id,'slack')
   and c.provider='slack' and c.status='configured' and c.revoked_at is null
   and c.updated_at=s.connection_revision and c.non_secret_config->>'team_id'=s.team_id
   and public.learn_slack_credential_field(c.non_secret_config)=any(c.configured_fields)
   and c.secret_refs->>public.learn_slack_credential_field(c.non_secret_config) is not null
   and ((p.tenant_id=s.tenant_id and p.role in('owner','admin')) or exists(
    select 1 from public.platform_authority_grants g where g.profile_id=p.id
     and g.permission='platform.controlplane.admin'
     and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
     and coalesce(g.effective_to,'infinity')>clock_timestamp()))
   and case p_table
    when 'slack_history_imports' then
     p_row->'definition'->>'recurringAccountId'=s.account_id::text
     and (p_row->'definition'->>'recurringRevision')::bigint=s.revision
     and p_row->'definition'->>'connectionId'=s.connection_id::text
     and (p_row->'definition'->>'connectionRevision')::timestamptz=s.connection_revision
     and p_row->'definition'->>'channelId'=s.channel_id
     and p_row->'definition'->'maxPages'='10'::jsonb
     and a.settings->'slack_history'->'maxPages'='10'::jsonb
     and a.settings->'slack_history'->>'consentReference'='learn-slack-import:'||(p_row->>'id')
     and a.settings->'slack_history'->>'connectionId'=s.connection_id::text
     and a.settings->'slack_history'->>'teamId'=s.team_id
     and a.settings->'slack_history'->>'channelId'=s.channel_id
     and extract(epoch from (p_row->'definition'->>'start')::timestamptz)=(a.settings->'slack_history'->>'oldest')::numeric
     and extract(epoch from (p_row->'definition'->>'end')::timestamptz)=(a.settings->'slack_history'->>'latest')::numeric
     and (p_row->'definition'->>'start')::timestamptz>='epoch'::timestamptz
     and (p_row->'definition'->>'end')::timestamptz>(p_row->'definition'->>'start')::timestamptz
     and (p_row->'definition'->>'end')::timestamptz-(p_row->'definition'->>'start')::timestamptz<=interval '15 minutes'
     and (p_row->'definition'->>'end')::timestamptz<=clock_timestamp()
     and exists(select 1 from public.platform_jobs j where j.id=(p_row->>'job_id')::uuid
      and j.tenant_id=s.tenant_id and j.created_by=s.approved_by and j.job_type='slack.history_sync'
      and j.status='queued' and j.payload->>'connector_account_id'=s.account_id::text)
    when 'slack_thread_imports' then s.include_threads
     and (p_row->'definition'->>'recurringRevision')::bigint=s.thread_revision
     and p_row->'definition'->>'recurringHistoryImportId'=s.current_import::text
     and p_row->'definition'->>'accountId'=s.account_id::text
     and (p_row->'definition'->>'connectionRevision')::timestamptz=s.connection_revision
     and p_row->'scope'->'approved'='true'::jsonb
     and p_row->'definition'->'maxPages'='10'::jsonb and p_row->'scope'->'maxPages'='10'::jsonb
     and p_row->'scope'->>'consentReference'='learn-slack-thread:'||(p_row->>'id')
     and p_row->'scope'->>'connectionId'=s.connection_id::text
     and p_row->'scope'->>'teamId'=s.team_id and p_row->'scope'->>'channelId'=s.channel_id
     and exists(select 1 from public.slack_history_imports i
      join public.slack_recurring_thread_windows w on w.history_import_id=i.id and w.tenant_id=i.tenant_id and w.account_id=i.account_id
      where i.id=s.current_import and i.tenant_id=s.tenant_id and i.account_id=s.account_id
       and w.recurring_revision=s.thread_revision
       and p_row->'definition'->'start'=i.definition->'start' and p_row->'definition'->'end'=i.definition->'end'
       and extract(epoch from (i.definition->>'start')::timestamptz)=(p_row->'scope'->>'oldest')::numeric
       and extract(epoch from (i.definition->>'end')::timestamptz)=(p_row->'scope'->>'latest')::numeric)
     and exists(select 1 from public.slack_messages m where m.id=(p_row->>'source_message_id')::uuid
      and m.tenant_id=s.tenant_id and m.team_id=s.team_id and m.channel_id=s.channel_id
      and p_row->'definition'->>'sourceMessageId'=m.id::text and p_row->'definition'->>'sourceVersion'=m.source_version
      and (p_row->'scope'->>'parentTimestamp')::numeric=case
       when m.thread_timestamp is not null and m.thread_timestamp::numeric<m.provider_timestamp::numeric then m.thread_timestamp::numeric
       when coalesce(m.provider_payload->>'reply_count','')~'^[0-9]+$' and (m.provider_payload->>'reply_count')::numeric>0 then m.provider_timestamp::numeric end)
     and exists(select 1 from public.platform_jobs j where j.id=(p_row->>'initial_job_id')::uuid
      and j.tenant_id=s.tenant_id and j.created_by=s.approved_by and j.job_type='slack.thread_sync'
      and j.status='queued' and j.payload->>'connector_account_id'=s.account_id::text
      and j.payload->>'thread_import_id'=p_row->>'id')
    else false end
 );
$$;
revoke all on function public.learn_slack_recurring_attribution_allowed(text,jsonb) from public,anon,authenticated,service_role;
do $$declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.learn_slack_reference_guard()'::regprocedure);
 needle:='   if auth.role() is distinct from ''authenticated'' or auth.uid() is null';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed Slack attribution guard differs';end if;
 replacement:='   if tg_op=''INSERT'' and public.learn_slack_recurring_attribution_allowed(tg_table_name,j) then continue;end if;'||chr(10)||needle;
 execute replace(d,needle,replacement);
end$$;
-- A paused recurring reply must wait without consuming attempts or reserving
-- workspace pacing. Already committed pages may still settle after a pause.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_slack_claim_jobs(uuid,integer)'::regprocedure);
 needle:='and public.learn_capture_job_allowed(q.tenant_id,q.job_type,q.metadata)';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed Slack claim scan differs';end if;
 d:=replace(d,needle,needle||chr(10)||'  and (q.job_type<>''slack.thread_sync'' or coalesce(q.metadata,''{}'') ? ''slack_page_v1'' or not exists(select 1 from public.slack_thread_imports t where t.id::text=q.payload->>''thread_import_id'' and t.tenant_id=q.tenant_id and t.definition ? ''recurringHistoryImportId'' and not public.learn_slack_recurring_thread_allowed(q.tenant_id,t.id)))');
 needle:='if not public.learn_capture_job_allowed(j.tenant_id,j.job_type,j.metadata) then continue;end if;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed Slack locked claim differs';end if;
 execute replace(d,needle,needle||chr(10)||'  if j.job_type=''slack.thread_sync'' and not(coalesce(j.metadata,''{}'') ? ''slack_page_v1'') and exists(select 1 from public.slack_thread_imports t where t.id::text=j.payload->>''thread_import_id'' and t.tenant_id=j.tenant_id and t.definition ? ''recurringHistoryImportId'' and not public.learn_slack_recurring_thread_allowed(j.tenant_id,t.id)) then continue;end if;');
end$$;

insert into of_learn_deploy.migrations values('learn_slack_recurring_attribution_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
