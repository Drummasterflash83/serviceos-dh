/** Catalog evidence only. Even a conforming catalog requires semantic and JWT tests. */
export const READER_ROLE = 'learn_launch_metadata_reader';
export const LAUNCH_METADATA_QUERY = `select jsonb_build_object(
 'reader',(select jsonb_build_object('name',r.rolname,'canLogin',r.rolcanlogin,
   'inherit',r.rolinherit,'superuser',r.rolsuper,'bypassRls',r.rolbypassrls,
   'createDb',r.rolcreatedb,'createRole',r.rolcreaterole,'replication',r.rolreplication,
   'publicCreate',pg_catalog.has_schema_privilege(r.oid,'public','CREATE'),
   'memberships',(select coalesce(jsonb_agg(jsonb_build_object('role',g.rolname,'member',m.rolname,
     'grantor',grantor.rolname,'admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option)),'[]')
     from pg_catalog.pg_auth_members a join pg_catalog.pg_roles g on g.oid=a.roleid
     join pg_catalog.pg_roles m on m.oid=a.member join pg_catalog.pg_roles grantor on grantor.oid=a.grantor
     where a.roleid=r.oid or a.member=r.oid))
   from pg_catalog.pg_roles r where r.rolname='learn_launch_metadata_reader'),
 'relations',(select coalesce(jsonb_agg(jsonb_build_object(
   'name',c.relname,'kind',c.relkind,'owner',o.rolname,'rls',c.relrowsecurity,
   'options',coalesce(to_jsonb(c.reloptions),'[]'),
   'definition',case when c.relkind='v' then pg_catalog.pg_get_viewdef(c.oid,true) else null end,
   'authenticatedSelect',pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT'),
   'anonSelect',pg_catalog.has_table_privilege('anon',c.oid,'SELECT'),
   'authenticatedWrite',pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES'),
   'readerWrite',case when r.oid is not null then pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') else null end,
   'columns',(select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,
     'readerSelect',case when r.oid is not null then pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,'SELECT') else null end,
     'readerWrite',case when r.oid is not null then pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,'INSERT,UPDATE,REFERENCES') else null end,
     'authenticatedSelect',pg_catalog.has_column_privilege('authenticated',c.oid,a.attnum,'SELECT'),
     'anonSelect',pg_catalog.has_column_privilege('anon',c.oid,a.attnum,'SELECT'),
     'authenticatedWrite',pg_catalog.has_column_privilege('authenticated',c.oid,a.attnum,'INSERT,UPDATE,REFERENCES')) order by a.attnum),'[]')
     from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.policyname,'roles',p.roles,'command',p.cmd,'using',p.qual,'check',p.with_check)),'[]')
     from pg_catalog.pg_policies p where p.schemaname='public' and p.tablename=c.relname)) order by c.relname),'[]')
   from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   join pg_catalog.pg_roles o on o.oid=c.relowner
   left join pg_catalog.pg_roles r on r.rolname='learn_launch_metadata_reader'
   where n.nspname='public' and c.relkind in ('r','p','v','m') and
     (c.relname like 'learn_launch_%' or c.relname in ('profiles','email_messages','phone_calls',
      'phone_recordings','phone_transcripts','email_accounts','google_workspace_mailboxes','email_sync_runs','phone_sync_runs')))
)`;

export function assessLaunchMetadata(catalog, contract) {
  const limit = 'Catalog checks do not prove projection redaction, policy semantics, HTTP/JWT access or deployment configuration.';
  if (catalog === undefined) return { state: 'not_observed', limitations: [limit] };
  if (!catalog || !Array.isArray(catalog.relations)) throw Error('Incomplete launch metadata catalog');
  const names = new Set();
  for (const r of catalog.relations) {
    if (typeof r.name !== 'string' || names.has(r.name) || !Array.isArray(r.columns)
      || !Array.isArray(r.options) || !Array.isArray(r.policies)) throw Error('Invalid launch metadata relation');
    names.add(r.name);
  }
  const roleIssues = [], reader = catalog.reader;
  if (!reader) roleIssues.push('missing_reader_role');
  else {
    if (reader.name !== READER_ROLE) roleIssues.push('unexpected_reader_role');
    for (const key of ['canLogin','inherit','superuser','bypassRls','createDb','createRole','replication','publicCreate'])
      if (reader[key] !== false) roleIssues.push(`reader_${key}_not_false`);
    // PostgreSQL 17 retains its automatic ADMIN-only creator grant. It provides
    // neither inherited privileges nor SET ROLE; allow only the known TEST table
    // owner, never an application user or a membership in another role.
    const sourceNames = ['profiles',...Object.keys(contract)];
    const owned = sourceNames.every(name=>catalog.relations.some(r=>r.name===name&&r.owner==='postgres'));
    if (!Array.isArray(reader.memberships) || reader.memberships.some(m=>!(owned
      && m.role===READER_ROLE && m.member==='postgres' && m.grantor==='supabase_admin'
      && m.admin===true && m.inherit===false && m.set===false))) roleIssues.push('reader_memberships_need_review');
  }
  const sources = Object.entries({ profiles: 'id,tenant_id,role', ...contract }).map(([name, raw]) => {
    const r = catalog.relations.find(r => r.name === name), issues = [];
    const expected = raw.split(',');
    if (!r) issues.push('missing_source');
    else {
      if (!['r','p'].includes(r.kind) || r.rls !== true || r.owner === READER_ROLE) issues.push('source_rls_authority_differs');
      if (r.readerWrite !== false || r.columns.some(c => c.readerWrite !== false)) issues.push('reader_source_write_or_unknown');
      if (expected.some(n => !r.columns.some(c => c.name === n && c.readerSelect === true))) issues.push('reader_required_columns_unavailable');
      if (r.columns.some(c => !expected.includes(c.name) && c.readerSelect !== false)) issues.push('reader_extra_columns_or_unknown');
      if (name !== 'profiles' && (r.authenticatedSelect !== false || r.anonSelect !== false
        || r.columns.some(c => c.authenticatedSelect !== false || c.anonSelect !== false))) issues.push('direct_source_read_exposure_or_unknown');
      const policyName = name === 'profiles' ? 'learn_launch_metadata_profile' : 'learn_launch_metadata_select';
      if (!r.policies.some(p => p.name === policyName && p.command === 'SELECT'
        && Array.isArray(p.roles) && p.roles.length === 1 && p.roles[0] === READER_ROLE)) issues.push('reader_policy_missing_or_different');
    }
    return { source: name, state: issues.length ? 'blocked' : 'needs_policy_semantics_verification', issues };
  });
  const views = Object.entries(contract).map(([name, raw]) => {
    const view = `learn_launch_${name}`, r = catalog.relations.find(r => r.name === view), issues = [];
    const expected = raw.split(',');
    if (!r) issues.push('missing_view');
    else {
      if (r.kind !== 'v' || r.owner !== READER_ROLE) issues.push('view_owner_or_kind_differs');
      if (!r.options.includes('security_barrier=true') || !r.options.includes('security_invoker=false')) issues.push('view_options_differ');
      if (r.columns.length !== expected.length || expected.some(n => !r.columns.some(c => c.name === n))) issues.push('view_columns_differ');
      if (r.authenticatedSelect !== true || r.columns.some(c => c.authenticatedSelect !== true)) issues.push('view_select_unavailable');
      if (r.anonSelect !== false || r.columns.some(c => c.anonSelect !== false)) issues.push('anonymous_view_access_or_unknown');
      if (r.authenticatedWrite !== false || r.columns.some(c => c.authenticatedWrite !== false)) issues.push('view_write_access_or_unknown');
      if (typeof r.definition !== 'string' || !r.definition.trim()) issues.push('view_definition_unavailable');
    }
    return { view, state: issues.length ? 'blocked' : 'needs_projection_and_user_verification', issues };
  });
  const expectedNames = Object.keys(contract).map(n => `learn_launch_${n}`);
  const unexpectedRelations = catalog.relations.filter(r => r.name.startsWith('learn_launch_') && !expectedNames.includes(r.name)).map(r => r.name);
  return { mode: 'test_metadata_views', state: roleIssues.length || unexpectedRelations.length
    || [...sources,...views].some(r => r.state === 'blocked') ? 'blocked' : 'needs_semantic_and_user_verification',
    roleIssues, unexpectedRelations, sources, views, limitations: [limit] };
}
