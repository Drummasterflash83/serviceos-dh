"""Combined metadata/foundation/rules rehearsal on the retained offline archive."""
import hashlib
import json
import re
import time
from pathlib import Path
from database_restore_sandbox import RecoveryError, RestoreSandbox
from restore_production_database import ROOT, IMAGE, PINNED_IMAGE, write_private, literal
from inspect_production_release_baseline import prepare_archive_roles
from native_copy_fingerprints import restored_fingerprints, compare_native_data

OUT=Path('.verification-results/production-rules-rehearsal-v2')
DIRECTORY=Path('supabase/release/learn-production')


def prefix(manifest):
    return "set role postgres;set serviceos.release_target='tgbnakbxwcqjeimygroz';set serviceos.release_source_sha256="+literal(manifest['sha256'])+';\n'


def run():
    OUT.mkdir(mode=0o700,exist_ok=False)
    report={'state':'preflight','productionChanged':False,'hostedTestChanged':False,'providerRequests':0,
        'fullReleaseAccepted':False,'signedInAcceptance':False}
    target=None;started=time.monotonic()
    try:
        packages=[]
        for name in ['001_launch_metadata_views','002_foundation_rules']:
            manifest=json.loads((DIRECTORY/(name+'.manifest.json')).read_text())
            sql=(DIRECTORY/(name+'.sql')).read_text()
            if hashlib.sha256(sql.encode()).hexdigest()!=manifest['sha256']:raise RecoveryError('Candidate pin differs')
            packages.append((manifest,sql))
        report['packages']=[{'name':n,'sha256':m['sha256']} for n,(m,_) in zip(['metadata','foundation_rules'],packages)]
        target=RestoreSandbox(image=IMAGE,network_extension=True,private_diagnostics=OUT/'private-error')
        with target:
            if target.image_id!=PINNED_IMAGE:raise RecoveryError('Pinned image differs')
            prepare_archive_roles(target,json.loads((ROOT/'source-inventory.json').read_text()))
            report['state']='restoring_offline_archive';write_private(OUT/'report.json',report);print(json.dumps({'stage':report['state']}),flush=True)
            archive=target.restore_native_archive(ROOT/'database.dump')
            if any(m['baselineArchive']!=archive for m,_ in packages):raise RecoveryError('Archive pin differs')
            report['containmentBefore']=target.verify_boundary()
            before=restored_fingerprints(target)
            inventory_sql=Path('scripts/verify/learn-release-schema-inventory.sql').read_text()
            schema_before=json.loads(target.query(inventory_sql))
            first,sql=packages[0];target.query(prefix(first)+sql)
            base_after_first=target.query(inventory_sql)
            rules,sql=packages[1]
            report['state']='rehearsing_foundation_rules';write_private(OUT/'report.json',report);print(json.dumps({'stage':report['state']}),flush=True)
            report['negativeChecks']=[]
            cases=[('wrong_target','Reviewed production target, deployer and checksum required',prefix(rules).replace('tgbnakbxwcqjeimygroz','saatxzwxvdvqevbnskxy')+sql),
                ('catalog_drift','Production foundation catalog differs from reviewed baseline',prefix(rules)+sql.replace('begin;\n','begin;\nalter table public.customer_cards add column rehearsal_rules_drift text;\n',1)),
                ('late_failure','division by zero',prefix(rules)+sql.replace('\ncommit;\n','\nselect 1/0;\ncommit;\n'))]
            for name,expected_error,query in cases:
                try:target.query(query)
                except RecoveryError:
                    diagnostic=Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                    if expected_error not in diagnostic:raise RecoveryError('Negative case failed for unexpected reason: '+name)
                    if target.query(inventory_sql)!=base_after_first:raise RecoveryError('Failure rollback changed schema')
                    report['negativeChecks'].append({'case':name,'expectedFailure':True,'schemaRestored':True})
                else:raise RecoveryError('Negative case unexpectedly passed')
            target.query(prefix(rules)+sql)
            report['existingReferencesAccepted']=True
            schema_after=json.loads(target.query(inventory_sql))
            triggers=re.findall(r'create trigger (\w+) (?:before|after) [^\n]*? on (?:public\.)?(\w+)',sql)
            if len(triggers)!=len(re.findall(r'create trigger ',sql)):raise RecoveryError('Trigger manifest parsing incomplete')
            indexes=re.findall(r'create (?:unique )?index (\w+)\s+on (?:public\.)?(\w+)',sql)
            actual={t['name']:t for t in schema_after['tables']}
            for original in schema_before['tables']:
                observed=dict(actual[original['name']]);name=original['name']
                for facet,known in [('triggers',triggers),('indexes',indexes)]:
                    added=[x for x in observed[facet] if x['name'] not in {v['name'] for v in original[facet]}]
                    if {x['name'] for x in added}!={n for n,t in known if t==name}:
                        raise RecoveryError('Unexpected foundation object changes')
                    observed[facet]=[x for x in observed[facet] if x not in added]
                added=[p for p in observed['policies'] if p['name'] not in {v['name'] for v in original['policies']}]
                if name in first['sourceTables']:
                    if len(added)!=2 or not any(p['name']=='learn_launch_production_boundary' for p in added):raise RecoveryError('Metadata policies differ')
                elif added:raise RecoveryError('Existing policies changed')
                observed['policies']=[p for p in observed['policies'] if p not in added]
                if observed!=original:raise RecoveryError('Existing table catalog not preserved')
            for f in schema_before['functions']:
                if f not in schema_after['functions']:raise RecoveryError('Existing helper replaced')
            for v in schema_before['views']:
                if v not in schema_after['views']:raise RecoveryError('Existing view changed')
            if set(actual)-{t['name'] for t in schema_before['tables']}!=set(rules['newTables']):raise RecoveryError('Unexpected new tables')
            report['existingCatalogPreservedExceptDeclaredAdditions']=True
            report['addedTriggers']=len(triggers);report['addedIndexes']=len(indexes)
            actor=json.loads(target.query("select json_build_object('id',p.id,'tenant',p.tenant_id) from public.profiles p where p.tenant_id is not null order by (select count(*) from public.customer_cards c where c.tenant_id=p.tenant_id) desc,p.id limit 1;"))
            if not actor:raise RecoveryError('Retained profile missing')
            probe=Path('scripts/verify/learn-production-rules.assert.sql').read_text()
            context="begin;set local serviceos.rehearsal_actor="+literal(actor['id'])+";set local serviceos.rehearsal_tenant="+literal(actor['tenant'])+';\n'
            # A request-scope profile role and all synthetic rules/membership exist
            # only in this rollback transaction, never in either hosted system.
            target.query(context+probe+'\nrollback;')
            report['ruleJourneyVerified']=True
            report['probeSha256']=hashlib.sha256(probe.encode()).hexdigest()
            after=restored_fingerprints(target)
            original_tables={(x['schema'],x['table']) for x in before['tables']}
            added=[x for x in after['tables'] if (x['schema'],x['table']) not in original_tables]
            if {(x['schema'],x['table'],x['rows']) for x in added}!={('of_learn_deploy','migrations',2),('public','learn_member_history',0),('public','learn_scorecard_publications',0)}:
                raise RecoveryError('Synthetic rows or unexpected receipts retained')
            after['tables']=[x for x in after['tables'] if (x['schema'],x['table']) in original_tables]
            original_sequences={x['name'] for x in before['sequences']}
            if {x['name'] for x in after['sequences']}-original_sequences!={'public.learn_member_history_sequence_seq'}:raise RecoveryError('Unexpected new sequence')
            after['sequences']=[x for x in after['sequences'] if x['name'] in original_sequences]
            report['sourcePreservation']=compare_native_data(before,after)
            try:target.query(prefix(rules)+sql)
            except RecoveryError:
                diagnostic=Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                if 'Production rules candidate objects already exist; inspect before retry' not in diagnostic:raise RecoveryError('Duplicate failed for unexpected reason')
                if json.loads(target.query(inventory_sql))!=schema_after:raise RecoveryError('Duplicate changed catalog')
                report['duplicateRejected']=True
            else:raise RecoveryError('Duplicate accepted')
            report['containmentAfter']=target.verify_boundary()
        report['containerRemoved']=target.cleaned;report['elapsedSeconds']=round(time.monotonic()-started,2)
        report['state']='production_metadata_and_rules_rehearsed_offline'
        write_private(OUT/'report.json',report);print(json.dumps(report),flush=True)
    except Exception as error:
        report['failure']=str(error) if isinstance(error,RecoveryError) else 'Rehearsal failed; inspect private diagnostics'
        report['containerRemoved']=bool(target and target.cleaned)
        write_private(OUT/'report.json',report);print(json.dumps(report),flush=True)
        raise SystemExit(1) from None


if __name__=='__main__':run()
