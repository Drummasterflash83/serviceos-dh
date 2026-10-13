"""Rehearse production package 024 after all 23 prerequisites in an offline restore."""
import argparse
import hashlib
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from rehearse_slack_historical_ranges import historical_probe
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
    if [int(p.name[:3]) for p in paths]!=list(range(1,25)):
        raise RecoveryError('Exact twenty-four packages required')
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
        m,sql=packages[22];target.query(prefix(m)+sql)
        print('All 23 prerequisites restored; checking matched campaign package.',flush=True)
        inventory=Path('scripts/verify/learn-release-schema-inventory.sql').read_text()
        schema=lambda:json.loads(target.query(inventory))
        before_schema=schema();before=without_ledger(restored_fingerprints(target))
        prior_schema=json.loads(Path('.verification-results/production-review-planning-rehearsal-v4/schema.json').read_text())
        expected_schema=json.loads(Path('.verification-results/slack-campaign-controller-rehearsal-v1/schema.json').read_text())
        if before_schema!=prior_schema:raise RecoveryError('Prior reviewed schema differs')
        ledger_sql="select jsonb_agg(to_jsonb(m) order by migration_name) from of_learn_deploy.migrations m where migration_name<>'learn_slack_campaigns_v1';"
        ledger=target.query(ledger_sql)
        m,sql=packages[-1]
        cases=[
            ('wrong_target','Production Slack campaign target/checksum required',prefix(m).replace('tgbnakbxwcqjeimygroz','saatxzwxvdvqevbnskxy')+sql),
            ('missing_checksum','Production Slack campaign target/checksum required',prefix(m).replace(m['sha256'],'invalid')+sql),
            ('missing_prerequisite','Pinned Slack campaign prerequisite missing',prefix(m)+sql.replace('begin;\n',"begin;delete from of_learn_deploy.migrations where migration_name='learn_commusoft_review_planning_v1';\n",1)),
            ('function_drift','Prior Slack function changed: learn_slack_history_state',prefix(m)+sql.replace('begin;\n',"begin;alter function public.learn_slack_history_state(uuid,uuid) set plan_cache_mode=force_generic_plan;\n",1)),
            ('preexisting_object','Slack campaign objects already exist;',prefix(m)+sql.replace('begin;\n',"begin;create table public.slack_history_campaigns(id uuid);\n",1)),
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
        after_schema=schema()
        write_private(out/'installed-schema.json',after_schema)
        # The earlier raw-migration proof ran as supabase_admin. Production packages
        # deliberately create new objects as postgres. Existing owners/ACLs must
        # stay exact; only the 19 new functions and seven new tables change owner.
        for function in expected_schema['functions']:
            if function['name'] in m['newFunctions']:
                if function['owner']!='supabase_admin':raise RecoveryError('Unexpected prior new-function owner')
                function['owner']='postgres'
        for table in expected_schema['tables']:
            if table['name'] in m['newTables']:
                if table['owner']!='supabase_admin':raise RecoveryError('Unexpected prior new-table owner')
                table['owner']='postgres'
                # Raw migration used the superuser owner plus the archive's
                # default postgres grant. Production has one postgres owner ACL.
                if {g['role'] for g in table['acl']}!={'postgres','supabase_admin'}:
                    raise RecoveryError('Unexpected prior new-table grants')
                owner_grants=[{**g,'role':'postgres'} for g in table['acl'] if g['role']=='supabase_admin']
                postgres_grants=[g for g in table['acl'] if g['role']=='postgres']
                if owner_grants!=postgres_grants:raise RecoveryError('New owner grants differ')
                table['acl']=postgres_grants
        if after_schema!=expected_schema:raise RecoveryError('Packaged schema differs from campaign journey schema')
        if target.query(ledger_sql)!=ledger:raise RecoveryError('Prior receipt changed')
        receipt=json.loads(target.query("select jsonb_agg(to_jsonb(m)) from of_learn_deploy.migrations m where migration_name='learn_slack_campaigns_v1';"))
        if len(receipt)!=1 or receipt[0]['source_sha256']!=m['sha256']:raise RecoveryError('Receipt differs')
        after=without_ledger(restored_fingerprints(target))
        added=[t for t in after['tables'] if t['schema']=='public' and t['table'] in m['newTables']]
        if len(added)!=7 or any(t['rows'] for t in added):raise RecoveryError('New campaign tables not empty')
        report['preservation']=compare_native_data(before,{**after,'tables':[t for t in after['tables'] if t not in added]})
        try:target.query(prefix(m)+sql)
        except RecoveryError:
            log=Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
            if 'Slack campaigns already installed; inspect before retry' not in log or schema()!=after_schema:
                raise RecoveryError('Duplicate guard differs')
        else:raise RecoveryError('Duplicate package accepted')
        options=SimpleNamespace(with_campaigns=True,with_campaign_threads=True,with_campaign_lifecycle=True,with_campaign_controller=True,with_message_kinds=True)
        report['campaigns']={}
        report['journeys'] = []
        for clone, names in [
            ('historical_tenant', ['learn-production-slack', 'learn-production-slack-threads', 'learn-slack-historical-recovery']),
            ('historical_operator', ['learn-production-slack-setup']),
            *([('campaigns', ['learn-slack-campaign'])] if options.with_campaigns else []),
            *([('campaign_threads', ['learn-slack-campaign-threads', *(['learn-slack-campaign-lifecycle'] if options.with_campaign_lifecycle else []), *(['learn-slack-campaign-controller'] if options.with_campaign_controller else [])])] if options.with_campaign_threads else []),
            *([('message_kinds', ['learn-production-slack', 'learn-slack-message-kinds'])] if options.with_message_kinds else []),
        ]:
            target.query('create database '+clone+' template postgres;')
            target.query('alter role supabase_admin in database '+clone+' set search_path=public,pg_catalog;')
            args = target._psql(); args[args.index('-d')+1] = clone
            try:
                for name in names:
                    path = Path('scripts/verify')/(name+'.assert.sql')
                    probe = 'set plpgsql.check_asserts=on;\n'+(path.read_text() if name in ('learn-slack-historical-recovery', 'learn-slack-message-kinds', 'learn-slack-campaign', 'learn-slack-campaign-threads', 'learn-slack-campaign-lifecycle', 'learn-slack-campaign-controller') else historical_probe(path))
                    if options.with_campaign_threads and name == 'learn-slack-campaign':
                        # The same retained root now queues its replies after channel completion.
                        probe = probe.replace("state='history_captured_threads_pending'", "state='thread_queued'")
                    (out/(name+'.sql')).write_text(probe)
                    result = subprocess.run([target.docker, *args], input=probe.encode(), stdout=subprocess.PIPE,
                                            stderr=subprocess.PIPE, timeout=300)
                    if result.returncode:
                        write_private(out/(name+'-error.json'), {'error': result.stderr.decode()})
                        raise RecoveryError('Historical journey failed: '+name)
                    report['journeys'].append({'path': str(path), 'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                              'probeSha256': hashlib.sha256(probe.encode()).hexdigest(), 'passed': True})
                    if name == 'learn-slack-campaign':
                        def reserve(slot):
                            probe = "set request.jwt.claim.role='service_role';set role service_role;select public.learn_slack_campaign_reserve_request(verify.id(1),job_id,claimed_by,attempt,"+('9' if slot==1 else '1')+") from verify.concurrent_jobs where slot="+str(slot)+";"
                            result = subprocess.run([target.docker,*args],input=probe.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
                            if result.returncode:
                                write_private(out/('campaign-race-'+str(slot)+'-error.json'), {'error':result.stderr.decode()})
                                raise RecoveryError('Campaign reservation race failed')
                            return result.stdout.decode().strip().splitlines()[-1]
                        with ThreadPoolExecutor(max_workers=2) as pool:
                            results = list(pool.map(reserve,[1,2]))
                        if sorted(results)!=['f','t']:
                            raise RecoveryError('Campaign shared budget was not enforced concurrently')
                        check = "do $$begin assert (select requests_reserved=9 from public.slack_history_campaigns where id=verify.id(60));assert (select count(*)=9 from public.slack_history_campaign_dispatches where campaign_id=verify.id(60));end$$;"
                        result = subprocess.run([target.docker,*args],input=check.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
                        if result.returncode:
                            raise RecoveryError('Campaign final concurrent budget differs')
                        report['campaigns']['concurrentLastReservationVerified'] = True
                    print('PASS: historical '+name, flush=True)
            finally:
                target.query('drop database '+clone+';')
        report['postJourneyPreservation']=compare_native_data(after,without_ledger(restored_fingerprints(target)))
        if schema()!=after_schema or target.query(ledger_sql)!=ledger:raise RecoveryError('Journeys changed retained schema/receipts')
        write_private(out/'schema.json',after_schema)
        report.update(state='production_slack_campaigns_rehearsed_offline',packages=24,packageSha256=m['sha256'],previouslyRehearsedSchemaWithExplicitNewPostgresOwnership=True,priorReceiptsUnchanged=True,duplicateRejected=True,newEmptyTables=7,containmentAfter=target.verify_boundary())
    report['containerRemoved']=target.cleaned
except Exception:
    report['state']='requires_inspection';report['containerRemoved']=bool(target and target.cleaned)
    raise
finally:
    write_private(out/'report.json',report)
print(json.dumps(report))
