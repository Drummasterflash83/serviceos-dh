"""Rehearse production package 023 after all 22 prerequisites in an offline restore."""
import argparse
import hashlib
import json
from pathlib import Path
from database_restore_sandbox import RestoreSandbox, RecoveryError
from restore_production_database import ROOT, IMAGE, PINNED_IMAGE, write_private
from inspect_production_release_baseline import prepare_archive_roles
from rehearse_production_rules import prefix
from rehearse_production_roster import without_ledger
from native_copy_fingerprints import restored_fingerprints, compare_native_data

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',required=True)
out=Path(parser.parse_args().output).resolve()
if out.parent!=Path('.verification-results').resolve() or out.exists():
    raise SystemExit('Fresh private output directory required')
out.mkdir(mode=0o700)
report={'state':'preflight','productionChanged':False,'hostedTestChanged':False,'providerRequests':0}
target=None
try:
    paths=sorted(Path('supabase/release/learn-production').glob('[0-9][0-9][0-9]_*.manifest.json'))
    if [int(p.name[:3]) for p in paths]!=list(range(1,24)):
        raise RecoveryError('Exact twenty-three packages required')
    packages=[]
    for path in paths:
        m=json.loads(path.read_text());sql=path.with_name(path.name.replace('.manifest.json','.sql')).read_text()
        if hashlib.sha256(sql.encode()).hexdigest()!=m['sha256']:
            raise RecoveryError('Package differs')
        sources=m.get('sources', [m['source']] if 'source' in m else [])
        for source in sources:
            if hashlib.sha256(Path(source['path']).read_bytes()).hexdigest()!=source['sha256']:
                raise RecoveryError('Source differs')
        packages.append((m,sql))
    target=RestoreSandbox(image=IMAGE,network_extension=True,storage_policy_hook=True,synthetic_vault=True,private_diagnostics=out/'private-error')
    with target:
        if target.image_id!=PINNED_IMAGE:raise RecoveryError('Image pin differs')
        prepare_archive_roles(target,json.loads((ROOT/'source-inventory.json').read_text()))
        archive=target.restore_native_archive(ROOT/'database.dump')
        if any(m['baselineArchive']!=archive for m,_ in packages):raise RecoveryError('Archive differs')
        report.update(archive=archive,containment=target.verify_boundary())
        for m,sql in packages[:21]:target.query(prefix(m)+sql)
        # Archived running rows cannot execute in this networkless clone. Simulate
        # the package-022 drain prerequisite only here, then restore exact values.
        running=int(target.query("select count(*) from public.platform_jobs where status='running'"))
        target.query("create schema review_planning_rehearsal;create table review_planning_rehearsal.archived_running as select id,status from public.platform_jobs where status='running';begin;alter table public.platform_jobs disable trigger user;update public.platform_jobs set status='cancelled' where id in(select id from review_planning_rehearsal.archived_running);alter table public.platform_jobs enable trigger user;commit;")
        m,sql=packages[21];target.query(prefix(m)+sql)
        target.query("begin;alter table public.platform_jobs disable trigger user;update public.platform_jobs j set status=r.status from review_planning_rehearsal.archived_running r where j.id=r.id;alter table public.platform_jobs enable trigger user;drop schema review_planning_rehearsal cascade;commit;")
        report['offlineDrainSimulation']={'archivedRunningRows':running,'originalValuesRestored':True,'liveDrainProven':False}
        print('All 22 prerequisites restored; checking planning package.',flush=True)
        inventory=Path('scripts/verify/learn-release-schema-inventory.sql').read_text()
        # Use the same default deparsing context as the prior 022 RPC catalog.
        schema=lambda:json.loads(target.query(inventory))
        before_schema=schema();before=without_ledger(restored_fingerprints(target))
        prior_schema=json.loads(Path('.verification-results/production-learning-rehearsal-v2/schema.json').read_text())
        if before_schema['functions']!=prior_schema['functions']:
            raise RecoveryError('Prior reviewed function catalog differs')
        report['priorReviewedFunctionCatalogMatches']=True
        signature="'public.learn_commusoft_work_review_search(uuid,uuid,text,text,text,integer)'::regprocedure"
        metadata="select jsonb_build_object('body',prosrc,'acl',proacl::text,'owner',pg_get_userbyid(proowner),'config',proconfig) from pg_proc where oid="+signature
        before_function=json.loads(target.query(metadata))
        ledger_sql="select jsonb_agg(to_jsonb(m) order by migration_name) from of_learn_deploy.migrations m where migration_name<>'learn_commusoft_review_planning_v1';"
        ledger=target.query(ledger_sql)
        m,sql=packages[-1]
        cases=[
            ('wrong_target','Production review-planning target/checksum required',prefix(m).replace('tgbnakbxwcqjeimygroz','saatxzwxvdvqevbnskxy')+sql),
            ('missing_prerequisite','Pinned review-planning prerequisite missing',prefix(m)+sql.replace('begin;\n',"begin;delete from of_learn_deploy.migrations where migration_name='learn_learning_delivery_reads_v1';\n",1)),
            ('reader_drift','Prior work-search reader changed',prefix(m)+sql.replace('begin;\n',"begin;alter function public.learn_commusoft_work_review_search(uuid,uuid,text,text,text,integer) set plan_cache_mode=force_generic_plan;\n",1)),
            ('late_failure','division by zero',prefix(m)+sql.replace('\ncommit;\n','\nselect 1/0;\ncommit;\n')),
        ]
        report['negativeChecks']=[]
        for name,expected,statement in cases:
            try:target.query(statement)
            except RecoveryError:
                log=Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                if expected not in log or schema()!=before_schema or target.query(ledger_sql)!=ledger:
                    raise RecoveryError('Negative check failed: '+name)
                report['negativeChecks'].append(name)
            else:raise RecoveryError('Negative case accepted: '+name)
        target.query(prefix(m)+sql.replace('\ncommit;\n','\nrollback;\n'))
        if schema()!=before_schema:raise RecoveryError('Rollback changed schema')
        compare_native_data(before,without_ledger(restored_fingerprints(target)))
        report['packageRollbackVerified']=True
        target.query(prefix(m)+sql)
        after_schema=schema();after_function=json.loads(target.query(metadata))
        expected={**before_function,'config':before_function['config']+['plan_cache_mode=force_custom_plan']}
        if after_function!=expected:raise RecoveryError('Function change exceeded planning setting')
        original=[f for f in before_schema['functions'] if f['name']!='learn_commusoft_work_review_search']
        updated=[f for f in after_schema['functions'] if f['name']!='learn_commusoft_work_review_search']
        if original!=updated or before_schema['tables']!=after_schema['tables'] or before_schema['views']!=after_schema['views']:
            raise RecoveryError('Unrelated schema changed')
        if target.query(ledger_sql)!=ledger:raise RecoveryError('Prior receipt changed')
        receipt=json.loads(target.query("select jsonb_agg(to_jsonb(m)) from of_learn_deploy.migrations m where migration_name='learn_commusoft_review_planning_v1';"))
        if len(receipt)!=1 or receipt[0]['source_sha256']!=m['sha256']:raise RecoveryError('Receipt differs')
        report['preservation']=compare_native_data(before,without_ledger(restored_fingerprints(target)))
        target.query('begin;set search_path=public,pg_catalog;'+Path('scripts/verify/learn-review-search-hosted.assert.sql').read_text()+'rollback;')
        try:target.query(prefix(m)+sql)
        except RecoveryError:
            log=Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
            if 'Review planning already installed; inspect before retry' not in log or schema()!=after_schema:
                raise RecoveryError('Duplicate guard differs')
        else:raise RecoveryError('Duplicate package accepted')
        compare_native_data(before,without_ledger(restored_fingerprints(target)))
        write_private(out/'schema.json',after_schema)
        report.update(state='production_review_planning_rehearsed_offline',packages=23,packageSha256=m['sha256'],bodyOwnerAndAclUnchanged=True,otherSchemaUnchanged=True,priorReceiptsUnchanged=True,permissionProbePassed=True,duplicateRejected=True)
    report['containerRemoved']=target.cleaned
except Exception:
    report['state']='requires_inspection';report['containerRemoved']=bool(target and target.cleaned)
    raise
finally:
    write_private(out/'report.json',report)
print(json.dumps(report))
