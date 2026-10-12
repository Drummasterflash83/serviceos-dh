/** Production-specific email protocol and durable capture; no provider activation. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(p,'utf8'),hash=s=>createHash('sha256').update(s).digest('hex');
const q=s=>`'${s.replaceAll("'","''")}'`,id=s=>`"${s.replaceAll('"','""')}"`;
const sources=[{"path": "supabase/reference/learn-email-ingestion-test-2026-10-10.json", "sha256": "8070cf839267c323b60a677b94e5a92cb553b43edaa59d16dcb0fb3b8ee8d062"}, {"path": "supabase/migrations/20261031233000_learn_email_transition_outbox.sql", "sha256": "8ba449af5bbd7334c683ca37780fe307c9f36228678f83ed2c7eb07901716e2a"}, {"path": "supabase/migrations/20261031234500_learn_email_job_attempts.sql", "sha256": "fae443075e7f1ff3d5a4ca3add9908fefb8a3e36bc126106ba3714d4defbc4cf"}, {"path": "supabase/migrations/20261031235500_learn_email_page_store.sql", "sha256": "021c1c4e7f83cf80a5cba8f7ddb685d06d20446c2bed3be2597d95439765c799"}, {"path": "supabase/migrations/20261031235900_learn_email_job_failure.sql", "sha256": "7cc57cf900f017a0dbf5c17899bad746f2d8ea7334d665271c5c2564b16148cb"}, {"path": "supabase/migrations/20261101000500_learn_email_paused_recovery.sql", "sha256": "9b5cc76035d17889fc2a01ea10c091478e7b69711c94c2770f870c249f9c6ebb"}, {"path": "supabase/migrations/20261101001500_learn_email_enqueue.sql", "sha256": "7fb1ffa5955a20b03963416c49dc1cf4264c5b662cce9c2ffb9fc134c42b114e"}, {"path": "supabase/migrations/20261101190000_learn_email_safe_failures.sql", "sha256": "82a333c36dc510bda5051c2eaa1ff1fc3645c659d3678fc198a2eb6639b21ee6"}, {"path": "supabase/migrations/20261101360000_learn_workspace_mailbox_identity.sql", "sha256": "2f457d516618fcd2dd55e97b6f8175f22ebc5fb304d9ef9e95ee82540a2e71a3"}, {"path": "supabase/migrations/20261101370000_learn_email_mailbox_coverage.sql", "sha256": "606941dc7372690ea871f265ce3371dcebd2ddbc2debe7bc68fa764e48faf0c9"}, {"path": "supabase/migrations/20261101400000_learn_email_mailbox_changes.sql", "sha256": "d8f6d39dd10a88acb3f46024ffd9c71bbba706fef0566b9f6e118f1232e4814e"}];
for(const source of sources)if(hash(read(source.path))!==source.sha256)throw Error('Email source pin differs');
const reference=JSON.parse(read(sources[0].path));
const baseline=JSON.parse(read('.verification-results/production-email-baseline-v1/schema.json'));
const report=JSON.parse(read('.verification-results/production-email-baseline-v1/report.json'));
const prior=JSON.parse(read('supabase/release/learn-production/009_commusoft_api.manifest.json'));
if(report.state!=='offline_email_prerequisites_inspected'||!report.containerRemoved||JSON.stringify(report.archive)!==JSON.stringify(prior.baselineArchive))throw Error('Email baseline unavailable');
if(reference.projectRef!=='saatxzwxvdvqevbnskxy'||reference.functions.length!==13)throw Error('Protocol reference changed');
const role='email_ingestion_protocol_owner';
const statements=[`create role ${role} nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;`,
 `grant ${role} to postgres with inherit true, set true;`,
 `grant usage on schema public,auth to ${role};`,
 `grant create on schema public to ${role};`,
 'create unique index email_sync_runs_tenant_id_id_v2 on public.email_sync_runs(tenant_id,id);'];
const protocolTables=reference.tables.filter(t=>t.name.startsWith('email_ingestion_'));
for(const t of protocolTables){
 statements.push(`create table public.${id(t.name)} (${t.columns.map(c=>`${id(c.name)} ${c.type}${c.default?' default '+c.default:''}${c.notNull?' not null':''}`).join(',')});`);
 for(const c of t.constraints)statements.push(`alter table public.${id(t.name)} add constraint ${id(c.name)} ${c.definition};`);
 const backing=new Set(t.constraints.filter(c=>['p','u','x'].includes(c.kind)).map(c=>c.name));
 for(const index of t.indexes)if(!backing.has(index.name))statements.push(index.definition+';');
 statements.push(`alter table public.${id(t.name)} enable row level security;`,
  `revoke all on public.${id(t.name)} from public,anon,authenticated,service_role;`,
  `grant select on public.${id(t.name)} to service_role;`);
}
for(const t of reference.tables)for(const p of t.policies.filter(p=>p.roles.length===1&&p.roles[0]===role)){
 statements.push(`create policy ${id(p.name)} on public.${id(t.name)} as ${p.permissive} for ${p.command} to ${role}${p.using?' using('+p.using+')':''}${p.check?' with check('+p.check+')':''};`);
}
for(const g of reference.protocolGrants){
 if(g.schema!=='public'||g.grantable||!['SELECT','INSERT','UPDATE'].includes(g.privilege))throw Error('Unexpected protocol grant');
 statements.push(`grant ${g.privilege}${g.column?'('+id(g.column)+')':''} on public.${id(g.table)} to ${role};`);
}
const functions=reference.functions.filter(f=>f.name.startsWith('email_ingestion_')||f.name==='platform_jobs_complete_email_v1');
for(const f of functions){
 const signature='public.'+id(f.name)+'('+f.arguments+')';
 statements.push(f.definition+';',`alter function ${signature} owner to ${id(f.owner)};`,
  `revoke all on function ${signature} from public,anon,authenticated,service_role;`);
 for(const grant of f.grants)if(grant.role!==f.owner)statements.push(`grant execute on function ${signature} to ${id(grant.role)};`);
}
for(const t of reference.tables)for(const trigger of t.triggers.filter(t=>t.name.startsWith('email_ingestion_')))statements.push(trigger.definition+';');
for(const source of sources.slice(1))statements.push('-- INPUT '+source.path+'\n'+read(source.path).replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,''));
// Remove executable deployer membership after installation. The automatic
// ADMIN-only creator grant may remain, without SET/INHERIT. Only SECURITY DEFINER
// entry points can use the private protocol role at runtime.
statements.push(`revoke create on schema public from ${role};`,`revoke ${role} from postgres;`);
const body=statements.join('\n');
const newTables=[...body.matchAll(/^create table (?:if not exists )?(?:public\.)?"?(\w+)/gmi)].map(m=>m[1]);
const declared=[...new Set([...body.matchAll(/^create (?:or replace )?function (?:public\.)?"?(\w+)\(/gmi)].map(m=>m[1]))];
const existingNames=new Set(baseline.functions.map(f=>f.name));
const newFunctions=declared.filter(n=>!existingNames.has(n));
const changedFunctions=['platform_jobs_claim','learn_capture_job_allowed'];
if(baseline.tables.some(t=>newTables.includes(t.name)))throw Error('Email tables already present');
const existingTables=baseline.tables.filter(t=>new RegExp('\\b'+t.name+'\\b').test(body)).map(t=>t.name);
const tableCatalog=baseline.tables.filter(t=>existingTables.includes(t.name)).sort((a,b)=>a.name.localeCompare(b.name));
const helpers=baseline.functions.filter(f=>['platform_jobs_claim','learn_capture_job_allowed','learn_capture_allowed','set_updated_at'].includes(f.name));
const inventory=read('scripts/verify/learn-release-schema-inventory.sql').trim().replace(/;$/,'');
const sql=`-- DRAFT: requires coordinated email worker deployment and production approval.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production Email target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_commusoft_api_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then raise exception 'Pinned production Commusoft prerequisite missing';end if;
 if exists(select 1 from pg_roles where rolname='${role}') or exists(select 1 from of_learn_deploy.migrations where migration_name='learn_email_capture_v1')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array[${newTables.map(q).join(',')}]))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${newFunctions.map(q).join(',')}])) then raise exception 'Production Email candidate already exists; inspect before retry';end if;
 select jsonb_agg(t order by t->>'name') into observed from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array[${existingTables.map(q).join(',')}]);
 if observed is distinct from ${q(JSON.stringify(tableCatalog))}::jsonb then raise exception 'Production Email table baseline differs';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into actual_helpers from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array['platform_jobs_claim','learn_capture_job_allowed','learn_capture_allowed','set_updated_at']);
 if actual_helpers is distinct from ${q(JSON.stringify(helpers))}::jsonb then raise exception 'Production Email helper baseline differs';end if;
end$$;
${body}
insert into of_learn_deploy.migrations values('learn_email_capture_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const out='supabase/release/learn-production/010_email_capture';
writeFileSync(out+'.sql',sql);
writeFileSync(out+'.manifest.json',JSON.stringify({version:'learn-production-email-capture/1',status:'draft_requires_rehearsal_and_production_approval',projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),priorSha256:prior.sha256,baselineArchive:prior.baselineArchive,sources,existingTables,newTables,newFunctions,changedFunctions,newSequences:[],newRole:role,
 extendedTables:{google_workspace_mailboxes:['directory_primary_email','directory_identity_conflict']},
 newExistingConstraints:{google_workspace_mailboxes:['google_workspace_directory_primary_email_valid']},
 newExistingIndexes:{email_sync_runs:['email_sync_runs_tenant_id_id_v2']},
 newExistingTriggers:{email_accounts:['email_ingestion_account_guard_v2'],email_sync_runs:['email_ingestion_run_guard_v2'],google_workspace_mailboxes:['learn_workspace_identity_guard'],email_messages:['learn_email_preserve_source_version']},
 newExistingPolicies:Object.fromEntries(reference.tables.filter(t=>!newTables.includes(t.name)).map(t=>[t.name,t.policies.filter(p=>p.roles.includes(role)).map(p=>p.name)])),
 limitations:['No seeded account, cursor, feature activation, credential or provider work.','Protocol guards require matching email workers; never install independently while incompatible legacy writers are active.','Communication projection/card draft eligibility, phone-aware operator health, real mailbox coverage and signed-in acceptance remain required.']},null,2)+'\n');
console.log(JSON.stringify({sha256:hash(sql),tables:newTables.length,functions:newFunctions.length}));
