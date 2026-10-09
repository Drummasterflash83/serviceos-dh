/** Additive TEST storage/setup release. No provider secrets, jobs or tenant seeds. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=new URL('../../',import.meta.url),hash=s=>createHash('sha256').update(s).digest('hex');
export const SLACK_TABLES=['tenant_connectors','connector_accounts','provider_connections','provider_connection_events','slack_messages','slack_message_versions','slack_history_imports'];
export const SLACK_FUNCTIONS=['slack_version_immutable','slack_history_commit_page','learn_slack_start_import'];
export const SLACK_RELEASE_NAME='learn_slack_storage_setup_v1';
export function buildSlack(){
 const parts=[],sources=[];
 function source(name,select,selection){const path='supabase/migrations/'+name,original=readFileSync(new URL(path,root),'utf8'),selected=select(original).replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');if(!selected)throw Error('Empty Slack selection');sources.push({path,sha256:hash(original),selectedSha256:hash(selected),selection});parts.push(`-- SOURCE ${name}\n-- Original SHA-256 ${hash(original)}\n${selected}`);}
 source('20260708120000_platform_connector_config.sql',s=>{const end=s.indexOf('-- ENVIRONMENT SEED');if(end<0)throw Error('Connector seed boundary changed');return s.slice(0,end);},'connector/account definitions, indexes, triggers and RLS only; exclude the Drummonds Simwood seed');
 source('20260811120000_provider_connections.sql',s=>s,'non-secret provider metadata and audit table; no Vault broker');
 source('20261029130000_learn_slack_history.sql',s=>s,'retained Slack messages/versions and scoped atomic publication');
 source('20261029140000_learn_slack_import_setup.sql',s=>s,'owner/admin approval and atomic durable enqueue');
 source('20261030090000_learn_slack_import_integrity.sql',s=>s,'source/approval retention, HTTP conflicts, serialized approval and restricted definer publication');
 const sql=`-- Generated TEST-only Slack storage/setup; no credentials, imports or provider requests.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target/checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_governed_work_actions_v1' and source_sha256='4f27681d0f6786b04374cb409fdea61babff40452f263ce8e3c9d43966f215f8' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Verified action authority prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='${SLACK_RELEASE_NAME}') then raise exception 'Slack storage release already exists';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array[${SLACK_TABLES.map(n=>`'${n}'`).join(',')}])) then raise exception 'Slack dependency table already exists';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${SLACK_FUNCTIONS.map(n=>`'${n}'`).join(',')}])) then raise exception 'Slack function already exists';end if;
end $$;
${parts.join('\n')}
-- Portable least privileges; publishing uses only the verified service RPC.
do $$ declare n text;begin
 foreach n in array array[${SLACK_TABLES.map(n=>`'${n}'`).join(',')}] loop
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
  execute format('grant select on public.%I to authenticated,service_role',n);
 end loop;
 foreach n in array array['tenant_connectors','connector_accounts','provider_connections'] loop
  execute format('grant insert,update on public.%I to service_role',n);
  execute format('alter table public.%I add constraint learn_connector_tenant_fk foreign key(tenant_id) references public.tenants(id)',n);
  execute format('create trigger learn_connector_reference_guard before insert or update on public.%I for each row execute function public.learn_foundation_reference_guard()',n);
  execute format('create trigger learn_connector_retain before delete on public.%I for each row execute function public.slack_version_immutable()',n);
  execute format('create trigger learn_connector_retain_truncate before truncate on public.%I for each statement execute function public.slack_version_immutable()',n);
 end loop;
end $$;
alter table provider_connection_events add constraint learn_provider_event_tenant_fk foreign key(tenant_id) references tenants(id);
grant insert on provider_connection_events to service_role;
create trigger learn_provider_events_retain before update or delete on provider_connection_events for each row execute function slack_version_immutable();
create trigger learn_provider_events_retain_truncate before truncate on provider_connection_events for each statement execute function slack_version_immutable();
create trigger learn_slack_import_reference_guard before insert or update on slack_history_imports for each row execute function learn_foundation_reference_guard();
revoke all on function slack_version_immutable() from public,anon,authenticated,service_role;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'${SLACK_RELEASE_NAME}','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
 return {sql,manifest:{version:'learn-slack-bundle/1',projectRef:'saatxzwxvdvqevbnskxy',releaseName:SLACK_RELEASE_NAME,sha256:hash(sql),tables:SLACK_TABLES,functions:SLACK_FUNCTIONS,sources,existingChanges:[],deferred:['Provider Vault broker/credential setup and worker/queue deployment.','Actual Slack authorization and source acceptance; threads, continuous ingestion and large historical imports.'],acceptanceNote:'Storage/setup prerequisite only. No production, tenant seeds, credentials, approvals, queue jobs or provider traffic created by installation.'}};
}
export function checkedSlack(){const b=buildSlack();if(readFileSync(new URL('supabase/release/learn-test/009_slack_storage_setup.sql',root),'utf8')!==b.sql||readFileSync(new URL('supabase/release/learn-test/009_slack_storage_setup.manifest.json',root),'utf8')!==JSON.stringify(b.manifest,null,2)+'\n')throw Error('Slack bundle differs from retained sources');return b;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv[2]==='--write'){const b=buildSlack();writeFileSync(new URL('supabase/release/learn-test/009_slack_storage_setup.sql',root),b.sql);writeFileSync(new URL('supabase/release/learn-test/009_slack_storage_setup.manifest.json',root),JSON.stringify(b.manifest,null,2)+'\n');console.log(b.manifest.sha256);}else{checkedSlack();console.log('Slack source manifest: PASS');}}
