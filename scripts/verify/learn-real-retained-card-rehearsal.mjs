/** Roll back a real retained-email -> interaction -> card rehearsal in the fixed
 * Drummonds TEST tenant. No provider, AI, queue worker, source changes or grants.
 * Reports contain counts/reasons only; private source content stays in TEST. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
const tenant='f8c114fa-fee7-4983-8970-f6e7f5fd3129';
if(process.argv.slice(2).join(' ')!=='--rehearse --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit fixed TEST rehearsal required');
const output='.verification-results/real-retained-card-rehearsal-v3-20261012.json';
const token=savedCliToken(),q=(sql,readOnly=true)=>communicationQuery(token,sql,{readOnly,fetcher:async(...args)=>{const r=await fetch(...args);if(!r.ok){const raw=await r.clone().text();writeFileSync(output+".error",raw,{mode:0o600});const names=[...raw.matchAll(/(?:identity|projection|processing)_[a-z_]+/g)].map(x=>x[0]);console.error(JSON.stringify({status:r.status,diagnosticNames:[...new Set(names)]}));}return r;}});
const tables=(await q(`select n.nspname||'.'||c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname in('public','storage','vault') or (n.nspname='auth' and c.relname in('users','identities'))) and c.relkind in('r','p') and not c.relispartition order by 1`)).map(r=>r.name);
if(tables.length<198||tables.some(t=>!/^(public|storage|vault|auth)\.[a-z][a-z0-9_]*$/.test(t)))throw Error('Preservation inventory differs');
const snapshot=tables.map(t=>`select '${t}' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from ${t} s`).join(' union all ');
const before=await q(snapshot);
const cronPresent=(await q("select to_regclass('cron.job') is not null present"))[0].present;
const scheduleCount=cronPresent?'(select count(*) from cron.job where active)':'0';
const checkSql=`select (select count(*) from public.email_messages where tenant_id='${tenant}')::int emails,(select count(*) from public.interactions where tenant_id='${tenant}')::int interactions,(select count(*) from public.platform_jobs where status='running')::int running,${scheduleCount}::int schedules`;
const pre=(await q(checkSql))[0];
if(pre.emails!==20||pre.interactions!==2||pre.running!==0||pre.schedules!==0)throw Error('Fixed retained sample or idle TEST scope differs');
const sql=`begin;
set local statement_timeout='30s';set local lock_timeout='3s';set local timezone='UTC';
-- Visible only inside this transaction; rollback restores the paused input flag.
update public.feature_flags set value='true'::jsonb where tenant_id='${tenant}' and flag='learn.inputs.email.enabled';
create temporary table card_rehearsal_results(kind text,state text,reason text,action text,card boolean) on commit drop;
do $$declare r record;x jsonb;begin
 if (select count(*) from public.email_messages where tenant_id='${tenant}')<>20 or (select count(*) from public.interactions where tenant_id='${tenant}')<>2 or exists(select 1 from public.platform_jobs where status='running') then raise exception 'fixed rehearsal scope changed';end if;
 for r in select * from public.learn_projection_pending('${tenant}','email',21) loop
  x:=public.learn_project_interaction('${tenant}',gen_random_uuid(),'email',r.source_id,r.source_revision,'publish');
  insert into card_rehearsal_results values('email_projection',x->>'state',x->>'reason',x->>'action',false);
 end loop;
 for r in select * from public.learn_identity_pending('${tenant}',23) loop
  x:=public.learn_identity_deliver('${tenant}',gen_random_uuid(),r.interaction_id,r.source_revision,'publish');
  insert into card_rehearsal_results values('identity_delivery',x->>'state',x->>'reason',null,(x->>'cardEnriched')::boolean);
 end loop;
end$$;
select jsonb_build_object('outcomes',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select kind,state,reason,action,card,count(*)::int total from card_rehearsal_results group by 1,2,3,4,5 order by 1,2,3,4,5)r),'cards',(select count(*) from public.customer_cards where tenant_id='${tenant}'),'emailInteractions',(select count(*) from public.interactions where tenant_id='${tenant}' and source_table='email_messages'),'emailSourceLinksValid',not exists(select 1 from public.interactions i where i.tenant_id='${tenant}' and i.source_table='email_messages' and not exists(select 1 from public.email_messages e where e.id=i.source_id and e.tenant_id=i.tenant_id)),'remainingEmailProjection',(select count(*) from public.learn_projection_pending('${tenant}','email',50)),'remainingIdentity',(select count(*) from public.learn_identity_pending('${tenant}',50))) result;
rollback;`;
writeFileSync(output+'.journal',JSON.stringify({state:'prepared_rollback_only',project:TEST_PROJECT,sourceSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),sqlSha256:createHash('sha256').update(sql).digest('hex')})+'\n',{mode:0o600,flag:'wx'});
const result=(await q(sql,false))[0]?.result;
const after=await q(snapshot);
if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Rollback preservation differs');
if(!result||!result.emailSourceLinksValid)throw Error('Rehearsal result unavailable');
const report={state:'real_retained_card_rehearsed_rollback_only',observedAt:new Date().toISOString(),projectRef:TEST_PROJECT,sourceEmails:20,existingSlackInteractions:2,preservedDatasets:tables.length,providerRequests:0,aiRequests:0,persistedChanges:0,newAccounts:0,newGrants:0,productionChanged:false,result,limitations:['Database rehearsal only; no worker HTTP dispatch or signed-in card acceptance.','Identity holds remain unresolved; no operator matching decision was made.']};
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
