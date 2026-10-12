"""Inspect operator prerequisites after packages 001–014 in an isolated archive restore."""
import hashlib
import json
from pathlib import Path
from database_restore_sandbox import RestoreSandbox, RecoveryError
from restore_production_database import ROOT, IMAGE, PINNED_IMAGE, write_private
from inspect_production_release_baseline import prepare_archive_roles
from rehearse_production_rules import prefix

OUT = Path('.verification-results/production-operator-baseline-v1')
DIRECTORY = Path('supabase/release/learn-production')


def run():
    OUT.mkdir(mode=0o700, exist_ok=False)
    report = {'state': 'preflight', 'productionChanged': False, 'hostedTestChanged': False}
    target = None
    try:
        target = RestoreSandbox(image=IMAGE, network_extension=True, storage_policy_hook=True,
                                private_diagnostics=OUT / 'private-error')
        with target:
            if target.image_id != PINNED_IMAGE:
                raise RecoveryError('Image pin differs')
            prepare_archive_roles(target, json.loads((ROOT / 'source-inventory.json').read_text()))
            archive = target.restore_native_archive(ROOT / 'database.dump')
            packages = sorted(DIRECTORY.glob('[0-9][0-9][0-9]_*.manifest.json'))
            packages = [p for p in packages if int(p.name[:3]) <= 14]
            if [int(p.name[:3]) for p in packages] != list(range(1, 15)):
                raise RecoveryError('Exact fourteen prerequisite packages required')
            report['packages'] = []
            for path in packages:
                manifest = json.loads(path.read_text())
                sql = path.with_name(path.name.replace('.manifest.json', '.sql')).read_text()
                if hashlib.sha256(sql.encode()).hexdigest() != manifest['sha256'] or manifest['baselineArchive'] != archive:
                    raise RecoveryError('Package or archive pin differs')
                target.query(prefix(manifest) + sql)
                report['packages'].append({'name': path.stem, 'sha256': manifest['sha256']})
            inventory = Path('scripts/verify/learn-release-schema-inventory.sql').read_text()
            catalog = json.loads(target.query('begin read only;set local search_path=public,pg_catalog;' + inventory + 'commit;'))
            write_private(OUT / 'schema.json', catalog)
            report.update(archive=archive, containment=target.verify_boundary())
        report.update(containerRemoved=target.cleaned, state='offline_operator_prerequisites_inspected')
        write_private(OUT / 'report.json', report)
        print(json.dumps(report), flush=True)
    except Exception as error:
        report.update(containerRemoved=bool(target and target.cleaned),
                      failure=str(error) if isinstance(error, RecoveryError) else 'Inspection failed; private diagnostics retained')
        write_private(OUT / 'report.json', report)
        print(json.dumps(report), flush=True)
        raise SystemExit(1) from None


if __name__ == '__main__':
    run()
