/** Reproducible foundation release from retained migration sources. */
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export const RELEASE_NAME='learn_card_work_foundations_v1';
const root=new URL('../../',import.meta.url);
export const SOURCE_FILES=[
 '20260709120000_customer_cards_foundation.sql','20260709140000_identity_engine.sql',
 '20260709160000_business_graph.sql','20260716120100_operating_profile.sql',
 '20260716120200_intelligence_objects.sql','20260716120300_ownership_policy_learning.sql',
 '20260818120000_operational_ownership.sql','20260814120000_universal_imports_and_jobs.sql',
 '20260716120400_domain_packs_and_events.sql',
];
const hash=s=>createHash('sha256').update(s).digest('hex');
const quoted=s=>`'${s.replaceAll("'","''")}'`;
function section(s,start,end){const a=s.indexOf(start),b=s.indexOf(end,a+start.length);if(a<0||b<0)throw Error('Source section changed');return s.slice(a,b);}
export function buildFoundation(){
  const sources=[],parts=[];
  for(const name of SOURCE_FILES){
    const source=readFileSync(new URL('supabase/migrations/'+name,root),'utf8');let sql=source,selection='whole file';
    if(name.includes('universal_imports_and_jobs')){
      const omitted=section(source,'-- ── Storage bucket for raw import files','-- ── triggers + RLS + grants');
      sql=source.replace(omitted,'-- Storage bucket and domain registry mutation deferred to the import release.\n');
      selection='table/index/trigger/policy definitions; storage bucket insert and domain registry update deferred';
    }
    if(name.includes('domain_packs_and_events')){
      const start=source.indexOf('create table if not exists domain_entity_types (');
      const end=source.indexOf('\n);',start);
      if(start<0||end<0)throw Error('Domain registry definition changed');
      sql=source.slice(start,end+3)+`\nalter table domain_entity_types enable row level security;
create policy domain_entity_types_select on domain_entity_types for select to authenticated using(true);\n`;
      selection='domain_entity_types table only; remaining pack/event/control dependencies stay in original migration';
    }
    sources.push({path:'supabase/migrations/'+name,sha256:hash(source),selection,selectedSha256:hash(sql)});
    parts.push(`-- SOURCE: ${name}\n-- Original SHA-256: ${hash(source)}\n${sql}`);
  }
  const body=parts.join('\n');
  const tables=[...body.matchAll(/^create table if not exists (\w+)\s*\(/gm)].map(m=>m[1]);
  const indexes=[...body.matchAll(/^create (?:unique )?index if not exists (\w+)\s/gm)].map(m=>m[1]);
  if(new Set(tables).size!==tables.length||tables.length!==33)throw Error('Foundation table contract changed');
  const globals=['domain_object_types','state_definitions','state_transitions','authority_permissions','domain_entity_types'];
  const optionalTenant=['operating_profile_entries','policies','import_profiles'];
  let boundary='-- Explicit privileges on NEW tables only; no raw communications grant changes.\n';
  for(const table of tables){
    boundary+=`revoke all on public.${table} from public,anon,authenticated;
grant select on public.${table} to authenticated;
grant select,insert,update,delete on public.${table} to service_role;\n`;
    if(globals.includes(table)||table==='org_unit_members')continue;
    boundary+=`create policy learn_foundation_tenant_boundary on public.${table} as restrictive for select to authenticated
 using(${optionalTenant.includes(table)?'tenant_id is null or ':''}tenant_id=public.current_tenant_id());\n`;
  }
  const integrity=`-- Validate declared same-tenant references even for trusted service writers.
-- Configuration versions and import profiles may be global; tenant parents may not be foreign.
create function public.learn_foundation_reference_guard() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
declare j jsonb:=to_jsonb(new); tenant uuid; parent_tenant uuid; fk record; rows_found bigint;
begin
 if tg_table_name='org_unit_members' then
  if tg_op='UPDATE' and (old.org_unit_id is distinct from new.org_unit_id or old.user_id is distinct from new.user_id) then
   raise exception 'Organisation membership identity is immutable' using errcode='23514';end if;
  select tenant_id into tenant from public.org_units where id=new.org_unit_id;
  if tenant is null then raise exception 'Organisation unit is missing' using errcode='23503';end if;
 else
  tenant:=(j->>'tenant_id')::uuid;
  if tg_op='UPDATE' and ((to_jsonb(old)->>'tenant_id') is distinct from (j->>'tenant_id')
    or (to_jsonb(old)->>'id') is distinct from (j->>'id')) then
   raise exception 'Foundation tenant and identity are immutable' using errcode='23514';end if;
  if tenant is not null and not exists(select 1 from public.tenants where id=tenant) then
   raise exception 'Tenant is missing' using errcode='23503';end if;
 end if;
 for fk in select sn.nspname as schema_name,pc.relname as table_name,sa.attname as child_column,pa.attname as parent_column
  from pg_constraint k join pg_class pc on pc.oid=k.confrelid join pg_namespace sn on sn.oid=pc.relnamespace
  join pg_attribute sa on sa.attrelid=k.conrelid and sa.attnum=k.conkey[1]
  join pg_attribute pa on pa.attrelid=k.confrelid and pa.attnum=k.confkey[1]
  where k.conrelid=tg_relid and k.contype='f' and cardinality(k.conkey)=1 and cardinality(k.confkey)=1
   and exists(select 1 from pg_attribute a where a.attrelid=k.confrelid and a.attname='tenant_id' and not a.attisdropped)
 loop
  if j->>fk.child_column is null then continue;end if;
  execute format('select tenant_id from %I.%I where %I=$1::uuid',fk.schema_name,fk.table_name,fk.parent_column)
   into parent_tenant using j->>fk.child_column;
  get diagnostics rows_found=row_count;
  if rows_found<>1 then raise exception 'Referenced foundation record is missing' using errcode='23503';end if;
  if not (fk.schema_name='public' and fk.table_name in ('config_versions','import_profiles') and parent_tenant is null)
    and parent_tenant is distinct from tenant then
   raise exception 'Referenced foundation record belongs to another tenant' using errcode='23514';end if;
 end loop;
 return new;
end $$;
revoke all on function public.learn_foundation_reference_guard() from public,anon,authenticated;
grant execute on function public.learn_foundation_reference_guard() to service_role;
${tables.filter(t=>!globals.includes(t)).map(t=>`create trigger learn_foundation_reference_guard before insert or update on public.${t}
 for each row execute function public.learn_foundation_reference_guard();`).join('\n')}
`;
  const sql=`-- Generated by scripts/verify/learn-foundation-bundle.mjs. Review source manifest.
-- TEST-only additive foundation. No customer/staff data, imports or providers are seeded.
begin;
set local search_path=public,pg_temp;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ declare n text; begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
  or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then
  raise exception 'Explicit TEST target and reviewed source checksum required'; end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_launch_metadata_views_v1'
  and project_ref='saatxzwxvdvqevbnskxy' and source_sha256='5bbff33c4ece496cd6220a9beb1fc0d70cb31e205f2deaa4a10026e4a3e219aa') then
  raise exception 'Verified metadata release prerequisite missing'; end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='${RELEASE_NAME}') then
  raise exception 'Foundation receipt exists; inspect before retrying'; end if;
 if to_regprocedure('public.learn_foundation_reference_guard()') is not null then
  raise exception 'Foundation reference guard already exists';end if;
 foreach n in array array[${[...tables,...indexes].map(quoted).join(',')}] loop
  if to_regclass('public.'||quote_ident(n)) is not null then raise exception 'Foundation relation already exists: %',n; end if;
 end loop;
end $$;
${body}
${boundary}
${integrity}
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'${RELEASE_NAME}','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
  return {sql,manifest:{version:'learn-foundation-bundle/1',projectRef:'saatxzwxvdvqevbnskxy',releaseName:RELEASE_NAME,
    sha256:hash(sql),tables,indexes,sources,existingDependencies:['tenants','profiles','config_versions','interactions','current_tenant_id()','is_openfolk()','set_updated_at()'],
    adjustments:['Explicit authenticated SELECT and service-role DML on new tables only.',
      'Restrictive same-tenant policies override historical OpenFolk cross-tenant reads; non-secret platform defaults remain readable.',
      'New tenant/identity fields are immutable; declared tenant references are checked on writes, including service writers. Global config versions and import profiles remain valid.',
      'Import storage bucket creation and domain registry mutation deferred; no tenant seed, import or provider job runs.'],
    remaining:['Objective/measurement/configuration hardening and LEARN scorecard RPCs.','Control-plane roster writers, operator authority and endpoint identity dependencies.',
      'Work/member capture and collectors, action-loop registries and source adapters.','Import bucket/policies and governed import acceptance.','Real user API/UI acceptance and provider reconciliation.']}};
}
export function checkedFoundation(){
  const generated=buildFoundation();
  if(readFileSync(new URL('supabase/release/learn-test/002_card_work_foundations.sql',root),'utf8')!==generated.sql
    ||readFileSync(new URL('supabase/release/learn-test/002_card_work_foundations.manifest.json',root),'utf8')!==JSON.stringify(generated.manifest,null,2)+'\n')
    throw Error('Foundation release differs from source manifest');
  return generated;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv[2]==='--write'){
    const b=buildFoundation();writeFileSync(new URL('supabase/release/learn-test/002_card_work_foundations.sql',root),b.sql);
    writeFileSync(new URL('supabase/release/learn-test/002_card_work_foundations.manifest.json',root),JSON.stringify(b.manifest,null,2)+'\n');
    console.log(`Generated ${b.manifest.tables.length} new-table foundation with ${b.manifest.sources.length} source records`);
  }else if(process.argv[2]==='--check'){checkedFoundation();console.log('Foundation source manifest: PASS');}
  else throw Error('Expected --write or --check');
}
