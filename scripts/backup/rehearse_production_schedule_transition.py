"""Exercise exact release pause/restore SQL in a cron-disabled archive restore.

No hosted access, exposed ports, network, credentials or provider operations.
Successful schedule restoration does not establish a safe application rollback.
"""
import argparse
import hashlib
import json
from pathlib import Path
from database_restore_sandbox import RestoreSandbox, RecoveryError
from restore_production_database import ROOT, IMAGE, PINNED_IMAGE, write_private
from inspect_production_release_baseline import prepare_archive_roles
from native_copy_fingerprints import restored_fingerprints, compare_native_data


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    out = Path(args.output).resolve()
    if out.parent != Path('.verification-results').resolve() or out.exists():
        raise SystemExit('Fresh private output directory required')
    out.mkdir(mode=0o700)
    report = {'state':'preflight','productionChanged':False,'hostedTestChanged':False,'providerRequests':0}
    target = None
    try:
        manifest_path = Path('supabase/release/learn-production/schedule-transition.manifest.json')
        manifest = json.loads(manifest_path.read_text())
        pins = [manifest['baseline'],manifest['runtime'],*manifest['outputs']]
        for p in pins:
            if hashlib.sha256(Path(p['path']).read_bytes()).hexdigest() != p['sha256']:
                raise RecoveryError('Release schedule input pin differs')
        sqls = {p['mode']:Path(p['path']).read_text() for p in manifest['outputs']}
        if set(sqls) != {'pause','restore'} or manifest['projectRef'] != 'tgbnakbxwcqjeimygroz':
            raise RecoveryError('Unexpected schedule transition scope')
        expected_archive = json.loads((ROOT/'report.json').read_text())['archive']
        archive_file = ROOT/'database.dump'
        if {'bytes':archive_file.stat().st_size,'sha256':hashlib.sha256(archive_file.read_bytes()).hexdigest()} != expected_archive:
            raise RecoveryError('Archive bytes changed')
        prefix = lambda mode: ("set role postgres;set serviceos.release_project='tgbnakbxwcqjeimygroz';"
            "set serviceos.release_manifest_sha256='"+manifest['runtime']['sha256']+"';"
            "set serviceos.release_schedule_action='"+mode+"';")
        target = RestoreSandbox(image=IMAGE,network_extension=True,storage_policy_hook=True,
                                private_diagnostics=out/'private-error')
        with target:
            if target.image_id != PINNED_IMAGE:
                raise RecoveryError('Pinned production image required')
            prepare_archive_roles(target,json.loads((ROOT/'source-inventory.json').read_text()))
            if target.restore_native_archive(archive_file) != expected_archive:
                raise RecoveryError('Restored archive differs')
            report.update(archive=expected_archive,containment=target.verify_boundary())
            print(json.dumps({'stage':'archive_restored_cron_disabled'}),flush=True)
            original = restored_fingerprints(target)
            snapshot_sql = "select coalesce(jsonb_agg(jsonb_build_object('id',jobid,'active',active,'hash',md5(to_jsonb(j)::text)) order by jobid),'[]') from cron.job j;"
            before = json.loads(target.query(snapshot_sql))
            report['originalSchedules'] = len(before)
            report['negativeChecks'] = []

            def rejected(name, statement, reason, expected):
                try:
                    target.query(statement)
                except RecoveryError:
                    log = Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                    if reason not in log or json.loads(target.query(snapshot_sql)) != expected:
                        raise RecoveryError('Rejected transition changed schedules or failed for wrong reason: '+name)
                    report['negativeChecks'].append(name)
                else:
                    raise RecoveryError('Unsafe schedule transition accepted: '+name)

            rejected('wrong_target',prefix('pause').replace('tgbnakbxwcqjeimygroz','saatxzwxvdvqevbnskxy')+sqls['pause'],
                     'Reviewed production release schedule target and action required',before)
            rejected('wrong_manifest',prefix('pause').replace(manifest['runtime']['sha256'],'0'*64)+sqls['pause'],
                     'Reviewed production release schedule target and action required',before)
            rejected('command_drift',prefix('pause')+sqls['pause'].replace('begin;\n',"begin;\nselect cron.alter_job(35,command := 'select 1');\n",1),
                     'Schedule baseline or active state differs',before)
            rejected('late_failure',prefix('pause')+sqls['pause'].replace('\ncommit;\n','\nselect 1/0;\ncommit;\n'),
                     'division by zero',before)
            target.query(prefix('pause')+sqls['pause'])
            paused = json.loads(target.query(snapshot_sql))
            ids = {r['jobid'] for r in json.loads(Path(manifest['baseline']['path']).read_text())['schedules']}
            changed = {row['id'] for row in paused if row not in before}
            if changed != ids or any(r['active'] for r in paused if r['id'] in ids):
                raise RecoveryError('Pause did not affect exactly the reviewed schedules')
            rejected('duplicate_pause',prefix('pause')+sqls['pause'],
                     'Schedule baseline or active state differs',paused)
            rejected('restore_command_drift',prefix('restore')+sqls['restore'].replace('begin;\n',"begin;\nselect cron.alter_job(35,command := 'select 1');\n",1),
                     'Schedule baseline or active state differs',paused)
            rejected('late_restore_failure',prefix('restore')+sqls['restore'].replace('\ncommit;\n','\nselect 1/0;\ncommit;\n'),
                     'division by zero',paused)
            target.query(prefix('restore')+sqls['restore'])
            if json.loads(target.query(snapshot_sql)) != before:
                raise RecoveryError('Original schedules not exactly restored')
            rejected('duplicate_restore',prefix('restore')+sqls['restore'],
                     'Schedule baseline or active state differs',before)
            after = restored_fingerprints(target)
            report['preservation'] = compare_native_data(original,after)
            if report['preservation']['state'] != 'all_archived_copy_rows_and_sequences_match':
                raise RecoveryError('Archived data not preserved')
            report.update(scheduleCount=9,unrelatedSchedulesPreserved=True,originalSchedulesExactlyRestored=True,
                          transitionManifestSha256=hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
                          outputs=manifest['outputs'],runtimeManifestSha256=manifest['runtime']['sha256'])
        report.update(state='schedule_pause_restore_rehearsed_offline',containerRemoved=target.cleaned,
                      inFlightWorkVerifiedStopped=False,
                      limitations=['Cron metadata only; does not establish in-flight drain, caller freeze, hosted execution or a compatible runtime rollback.',
                                   'No production schedule was changed. Final release approval and a durable execution journal remain required.'])
        write_private(out/'report.json',report)
        print(json.dumps(report),flush=True)
    except Exception as error:
        report.update(state='rehearsal_failed',containerRemoved=bool(target and target.cleaned),
                      failure=str(error) if isinstance(error,RecoveryError) else 'Rehearsal failed; inspect private diagnostics')
        write_private(out/'report.json',report)
        print(json.dumps(report),flush=True)
        raise SystemExit(1) from None


if __name__ == '__main__':
    run()
