/** Reproducible TEST scorecard rules/publication and forward membership release. */
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const root=new URL('../../',import.meta.url),hash=s=>createHash('sha256').update(s).digest('hex');
export const RULES_RELEASE_NAME='learn_rules_membership_v1';
const inputs=['20260819120000_view_as_and_superadmin.sql','20261029120000_learn_scorecard_drafts.sql','20261029220000_learn_member_history.sql','20261030000000_learn_scorecard_publication.sql','20261030020000_learn_scorecard_draft_reader.sql'];
export function buildRules(){
 const sources=[],parts=[];
 for(const name of inputs){
  const original=readFileSync(new URL('supabase/migrations/'+name,root),'utf8');let selected=original,selection='whole file';
  if(name.includes('view_as_and')){
   const start=original.indexOf('create table if not exists view_as_context ('),end=original.indexOf('-- ── 3. Additive Action');
   if(start<0||end<start)throw Error('View-As source framing changed');
   selected=original.slice(start,end);selection='View-As context table/index/RLS only; permission vocabulary and action transitions remain deferred';
  }
  if(name.includes('scorecard_drafts')){
   if(original.split('\nbegin;\n').length!==2||original.split('\ncommit;\n').length!==2)throw Error('Draft transaction framing changed');
   selected=original.replace('\nbegin;\n','\n').replace('\ncommit;\n','\n');selection='whole file inside enclosing release transaction';
  }
  if(name.includes('learn_member_history')){
   selected=selected.replaceAll('set search_path=public as','set search_path=public,pg_temp as');
   selection='whole file; temporary schema explicitly last in function search paths';
  }
  sources.push({path:'supabase/migrations/'+name,sha256:hash(original),selectedSha256:hash(selected),selection});
  parts.push(`-- SOURCE ${name}\n-- Original SHA-256 ${hash(original)}\n${selected}`);
 }
 const body=parts.join('\n');
 const tables=['view_as_context','learn_member_history','learn_scorecard_publications'];
 const functions=[...body.matchAll(/^create (?:or replace )?function public\.(\w+)\(/gm)].map(m=>m[1]);
 if(tables.length!==3||functions.length!==10)throw Error('Rules object contract changed');
 const sql=`-- Generated TEST-only rules/publication/membership release. No baseline or customer seed.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ declare n text;begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_foundation_helper_access_v1'
 and project_ref='saatxzwxvdvqevbnskxy' and source_sha256='16f222842b2d4d39387150edb696ffea7991daef36ffdb88c248216cf42b0647') then raise exception 'Verified foundation prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='${RULES_RELEASE_NAME}') then raise exception 'Rules release already exists';end if;
 foreach n in array array[${tables.map(t=>`'${t}'`).join(',')}] loop
  if to_regclass('public.'||n) is not null then raise exception 'Rules table already exists: %',n;end if;
 end loop;
 if exists(select 1 from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname=any(array[${functions.map(f=>`'${f}'`).join(',')}])) then raise exception 'Rules function already exists';end if;
end $$;
${body}
revoke all on function public.learn_scorecard_save_draft(uuid,integer,jsonb,text) from service_role;
-- Explicitly release the current user's role helper for publication RLS. No body changes.
grant execute on function public.current_user_role() to authenticated;
-- A browser can inspect only its own same-company preview context. No preview writer is released.
revoke all on public.view_as_context from public,anon,authenticated,service_role;
grant select on public.view_as_context to authenticated;
grant select,insert,update,delete on public.view_as_context to service_role;
create policy learn_view_as_actor_boundary on public.view_as_context as restrictive for select to authenticated
 using(tenant_id=public.current_tenant_id() and actor_user_id=auth.uid());
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'${RULES_RELEASE_NAME}','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
 return {sql,manifest:{version:'learn-rules-bundle/1',projectRef:'saatxzwxvdvqevbnskxy',releaseName:RULES_RELEASE_NAME,sha256:hash(sql),tables,functions,sources,
  existingChanges:['Scorecard-only retention triggers on config_versions and operating_profile_entries; unique saved revision index.',
   'Forward membership capture and deletion/truncation guards on team_members; no baseline/backfill.',
   'Authenticated execution of current_user_role() for publication RLS; function body and source grants unchanged.'],
  deferred:['Objective/measurement/review and work-capture/collector RPCs.','Preview creation/control-plane writers and complete staff collection permissions.','Source adapters and real source reconciliation.'],
  acceptanceNote:'Published rules and membership history are intentionally retained. Hosted acceptance must use a marked retained test tenant or transactional rollback, not disable retention guards to delete fixtures.'}};
}
export function checkedRules(){
 const b=buildRules();
 if(readFileSync(new URL('supabase/release/learn-test/004_rules_membership.sql',root),'utf8')!==b.sql||readFileSync(new URL('supabase/release/learn-test/004_rules_membership.manifest.json',root),'utf8')!==JSON.stringify(b.manifest,null,2)+'\n')throw Error('Rules release differs from retained source manifest');
 return b;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv[2]==='--write'){const b=buildRules();writeFileSync(new URL('supabase/release/learn-test/004_rules_membership.sql',root),b.sql);writeFileSync(new URL('supabase/release/learn-test/004_rules_membership.manifest.json',root),JSON.stringify(b.manifest,null,2)+'\n');console.log('Generated rules/publication/membership release');}
 else if(process.argv[2]==='--check'){checkedRules();console.log('Rules source manifest: PASS');}else throw Error('Expected --write or --check');
}
