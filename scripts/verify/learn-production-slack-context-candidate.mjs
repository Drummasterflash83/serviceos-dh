/** Prepare only: immutable Slack context reviews; creates no review or active capture. */
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root='supabase/release/learn-production/', read=p=>readFileSync(p,'utf8'), hash=v=>createHash('sha256').update(v).digest('hex');
const prior=JSON.parse(read(root+'020_commusoft_recurring.manifest.json'));
if(hash(read(root+'020_commusoft_recurring.sql'))!==prior.sha256)throw Error('Prior package changed');
const path='supabase/migrations/20261101600000_learn_slack_work_context.sql',source=read(path);
const rehearsal=JSON.parse(read('.verification-results/slack-work-context-rehearsal-v3/report.json'));
if(rehearsal.state!=='slack_work_context_full_schema_rehearsed'||!rehearsal.containerRemoved||!rehearsal.migrationRollbackVerified||!rehearsal.journeyRollbackVerified||rehearsal.migrationSha256!==hash(source)||rehearsal.preservation.tables<386)throw Error('Exact full-schema rehearsal required');
const body=source.replace(/^begin;\n/m,'').replace(/^commit;\n/m,'');
const newFunctions=['learn_slack_context_state','learn_operator_slack_context','learn_operator_slack_context_review','learn_slack_context_source_changed'].sort();
const sql=`-- DRAFT: retained Slack job/company context with audited review; no capture activation.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'')!~'^[a-f0-9]{64}$'
 then raise exception 'Production Slack context target/checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_commusoft_recurring_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}')
 then raise exception 'Pinned Slack context prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_slack_work_context_v1')
 or to_regclass('public.learn_slack_context_reviews') is not null
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${newFunctions.map(v=>"'"+v+"'").join(',')}]))
 then raise exception 'Slack context already exists; inspect before retry';end if;
end$$;
${body}
insert into of_learn_deploy.migrations values('learn_slack_work_context_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const stem=root+'021_slack_work_context';
writeFileSync(stem+'.sql',sql,{flag:'wx'});
writeFileSync(stem+'.manifest.json',JSON.stringify({version:'learn-production-slack-work-context/1',status:'prepared_requires_matching_release_verification',projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),priorSha256:prior.sha256,baselineArchive:prior.baselineArchive,sources:[{path,sha256:hash(source)}],newFunctions,changedFunctions:[],newTables:['learn_slack_context_reviews'],changedViews:[],newSequences:[],extendedTables:{},limitations:['Installation creates no reviews, accounts, grants, credentials or capture.','Only a reviewed retained Slack interaction changes; original direction and source evidence remain.','Job/company review is not proof of AI insight, scoring or complete Slack history.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({state:'prepared',sha256:hash(sql),productionChanged:false}));
